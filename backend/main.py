import io
import logging
import os
import urllib.request
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Plate Detector")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_MODEL_PATH = Path(os.environ.get("MODEL_CACHE_DIR", "/app/models")) / "best.pt"
_model: YOLO | None = None


def _is_lfs_pointer(path: Path) -> bool:
    """Return True if the file is a Git LFS pointer (not real weights)."""
    try:
        with open(path, "rb") as f:
            return f.read(40).startswith(b"version https://git-lfs")
    except Exception:
        return False


def _download_model(url: str, dest: Path) -> bool:
    """Download a .pt file from url into dest. Returns False on any failure."""
    try:
        logger.info(f"Downloading model from {url} …")
        dest.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, str(dest))
        if _is_lfs_pointer(dest):
            logger.warning("Downloaded file is a Git LFS pointer — not real weights.")
            dest.unlink(missing_ok=True)
            return False
        logger.info(f"Model saved to {dest} ({dest.stat().st_size // 1024} KB)")
        return True
    except Exception as exc:
        logger.warning(f"Download failed: {exc}")
        dest.unlink(missing_ok=True)
        return False


def get_model() -> YOLO:
    global _model
    if _model is not None:
        return _model

    # 1. Use pre-downloaded model if present
    if _MODEL_PATH.exists() and not _is_lfs_pointer(_MODEL_PATH):
        logger.info(f"Loading model from {_MODEL_PATH}")
        _model = YOLO(str(_MODEL_PATH))
        return _model

    # 2. Try MODEL_URL env var (set via Railway dashboard)
    model_url = os.environ.get("MODEL_URL")
    if model_url and _download_model(model_url, _MODEL_PATH):
        _model = YOLO(str(_MODEL_PATH))
        return _model

    # 3. Fallback — generic YOLOv8n (works, but not plate-specific)
    logger.warning("No plate-specific model found — falling back to yolov8n.pt")
    _model = YOLO("yolov8n.pt")
    return _model


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def health():
    return {"status": "ok", "model": str(_MODEL_PATH) if _MODEL_PATH.exists() else "yolov8n.pt"}


@app.post("/detect-plate")
async def detect_plate(file: UploadFile = File(...)):
    try:
        img_bytes = await file.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}")

    W, H = img.size
    model = get_model()

    results = model(img, conf=0.25, verbose=False)

    if not results or len(results[0].boxes) == 0:
        logger.info("No plate detected")
        return {"found": False}

    boxes = results[0].boxes
    best_idx = int(boxes.conf.argmax())
    x1, y1, x2, y2 = boxes.xyxy[best_idx].tolist()
    conf = float(boxes.conf[best_idx])

    nx1, ny1, nx2, ny2 = x1 / W, y1 / H, x2 / W, y2 / H
    logger.info(f"Plate: ({nx1:.3f},{ny1:.3f})-({nx2:.3f},{ny2:.3f}) conf={conf:.2f}")

    return {
        "found": True,
        "x1": round(nx1, 4),
        "y1": round(ny1, 4),
        "x2": round(nx2, 4),
        "y2": round(ny2, 4),
        "conf": round(conf, 3),
    }
