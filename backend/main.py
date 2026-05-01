import io
import logging
import os
import urllib.request
from pathlib import Path

import cv2
import numpy as np
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
    try:
        with open(path, "rb") as f:
            return f.read(40).startswith(b"version https://git-lfs")
    except Exception:
        return False


def _download_model(url: str, dest: Path) -> bool:
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
    if _MODEL_PATH.exists() and not _is_lfs_pointer(_MODEL_PATH):
        logger.info(f"Loading model from {_MODEL_PATH}")
        _model = YOLO(str(_MODEL_PATH))
        return _model
    model_url = os.environ.get("MODEL_URL")
    if model_url and _download_model(model_url, _MODEL_PATH):
        _model = YOLO(str(_MODEL_PATH))
        return _model
    logger.warning("No plate-specific model found — falling back to yolov8n.pt")
    _model = YOLO("yolov8n.pt")
    return _model


# ---------------------------------------------------------------------------
# OpenCV corner refinement
# ---------------------------------------------------------------------------

def _order_corners(pts: np.ndarray) -> np.ndarray:
    """
    Order 4 points as [tl, tr, br, bl] using sum/diff trick.
    Robust for tilted rectangles.
    """
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=float)


def refine_corners(img_rgb: np.ndarray, bbox: dict, pad: float = 0.20) -> list[dict] | None:
    """
    Crop the plate region from img_rgb (H×W×3) with padding, then use
    OpenCV to detect the actual plate quadrilateral.

    Returns [tl, tr, br, bl] as normalised {x, y} dicts (relative to full image),
    or None if refinement fails.
    """
    H, W = img_rgb.shape[:2]

    # Expand bbox by pad fraction of its own size
    pw = (bbox["x2"] - bbox["x1"]) * pad
    ph = (bbox["y2"] - bbox["y1"]) * pad
    cx1 = int(max(0,  (bbox["x1"] - pw) * W))
    cy1 = int(max(0,  (bbox["y1"] - ph) * H))
    cx2 = int(min(W,  (bbox["x2"] + pw) * W))
    cy2 = int(min(H,  (bbox["y2"] + ph) * H))

    crop = img_rgb[cy1:cy2, cx1:cx2]
    ch, cw = crop.shape[:2]
    if cw < 20 or ch < 8:          # too small to process
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 30, 120)
    # Dilate to close small gaps in plate border
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    min_area  = cw * ch * 0.08   # at least 8% of crop area

    quad = None
    for cnt in contours[:6]:
        if cv2.contourArea(cnt) < min_area:
            break
        peri   = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.04 * peri, True)
        if len(approx) == 4:
            quad = approx.reshape(4, 2).astype(float)
            break

    if quad is None:
        # Fallback: oriented bounding box of the largest contour
        rect = cv2.minAreaRect(contours[0])
        quad = cv2.boxPoints(rect).astype(float)

    ordered = _order_corners(quad)   # [tl, tr, br, bl] in crop coords

    # Sanity: reject if result is barely different from the axis-aligned bbox
    # (means contour detection found nothing useful)
    crop_tl = ordered[0]; crop_br = ordered[2]
    margin  = max(cw, ch) * 0.05
    is_trivial = (
        abs(crop_tl[0]) < margin and abs(crop_tl[1]) < margin and
        abs(crop_br[0] - cw) < margin and abs(crop_br[1] - ch) < margin
    )
    if is_trivial:
        return None

    # Map crop-relative pixels → normalised full-image coords
    corners = []
    for pt in ordered:
        corners.append({
            "x": round(float(cx1 + pt[0]) / W, 4),
            "y": round(float(cy1 + pt[1]) / H, 4),
        })
    return corners   # [tl, tr, br, bl]


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

    boxes    = results[0].boxes
    best_idx = int(boxes.conf.argmax())
    x1, y1, x2, y2 = boxes.xyxy[best_idx].tolist()
    conf = float(boxes.conf[best_idx])

    bbox = {
        "x1": round(x1 / W, 4),
        "y1": round(y1 / H, 4),
        "x2": round(x2 / W, 4),
        "y2": round(y2 / H, 4),
    }
    logger.info(f"YOLO bbox: ({bbox['x1']},{bbox['y1']})-({bbox['x2']},{bbox['y2']}) conf={conf:.2f}")

    # OpenCV refinement → oriented corners
    img_np  = np.array(img)
    corners = refine_corners(img_np, bbox)
    if corners:
        logger.info(f"Refined corners: {corners}")
    else:
        logger.info("Corner refinement failed — returning bbox only")

    return {
        "found":   True,
        "conf":    round(conf, 3),
        "bbox":    bbox,
        "corners": corners,   # list[{x,y}] × 4 ordered [tl,tr,br,bl], or null
    }
