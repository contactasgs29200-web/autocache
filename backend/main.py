import io
import logging

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

_model: YOLO | None = None


def get_model() -> YOLO:
    global _model
    if _model is None:
        logger.info("Loading yolov8n.pt…")
        _model = YOLO("yolov8n.pt")  # auto-téléchargé depuis ultralytics
        logger.info("Model ready")
    return _model


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/detect-plate")
async def detect_plate(file: UploadFile = File(...)):
    try:
        img_bytes = await file.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

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
    logger.info(f"Plate found: ({nx1:.3f},{ny1:.3f})-({nx2:.3f},{ny2:.3f}) conf={conf:.2f}")

    return {
        "found": True,
        "x1": round(nx1, 4),
        "y1": round(ny1, 4),
        "x2": round(nx2, 4),
        "y2": round(ny2, 4),
        "conf": round(conf, 3),
    }
