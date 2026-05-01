import io
import logging
import math
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


# French plate aspect ratio constants ----------------------------------
PLATE_AR_TARGET   = 4.7    # 520 mm / 110 mm
PLATE_AR_MIN_HARD = 3.0    # below ⇒ reject
PLATE_AR_MAX_HARD = 6.5    # above ⇒ reject


def _quad_aspect_ratio(quad: np.ndarray) -> float:
    width  = (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) * 0.5
    height = (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) * 0.5
    if height < 1e-6:
        return 0.0
    return float(width / height)


def _quad_area(quad: np.ndarray) -> float:
    return float(abs(cv2.contourArea(quad.astype(np.float32))))


def _quad_center(quad: np.ndarray) -> np.ndarray:
    return quad.mean(axis=0)


def _quad_inside_bbox_ratio(quad: np.ndarray, bbox_xyxy: tuple) -> float:
    """Fraction of quad area lying inside the axis-aligned bbox."""
    bx1, by1, bx2, by2 = bbox_xyxy
    minx = int(min(quad[:, 0].min(), bx1)) - 2
    miny = int(min(quad[:, 1].min(), by1)) - 2
    maxx = int(max(quad[:, 0].max(), bx2)) + 2
    maxy = int(max(quad[:, 1].max(), by2)) + 2
    w = max(1, maxx - minx)
    h = max(1, maxy - miny)
    mq = np.zeros((h, w), dtype=np.uint8)
    pts = (quad - [minx, miny]).astype(np.int32)
    cv2.fillPoly(mq, [pts], 1)
    qarea = int(mq.sum())
    if qarea == 0:
        return 0.0
    mb = np.zeros_like(mq)
    cv2.rectangle(
        mb,
        (max(0, int(bx1) - minx), max(0, int(by1) - miny)),
        (min(w, int(bx2) - minx), min(h, int(by2) - miny)),
        1, -1,
    )
    return float(int((mq & mb).sum())) / float(qarea)


def _quad_pixel_stats(quad: np.ndarray, gray: np.ndarray) -> tuple[float, float]:
    """Return (mean_brightness, std) of pixels inside quad — both in [0, 1]."""
    H, W = gray.shape[:2]
    minx = max(0, int(quad[:, 0].min()))
    miny = max(0, int(quad[:, 1].min()))
    maxx = min(W, int(quad[:, 0].max()) + 1)
    maxy = min(H, int(quad[:, 1].max()) + 1)
    if maxx - minx < 4 or maxy - miny < 4:
        return 0.0, 0.0
    sub = gray[miny:maxy, minx:maxx]
    mask = np.zeros(sub.shape, dtype=np.uint8)
    pts = (quad - [minx, miny]).astype(np.int32)
    cv2.fillPoly(mask, [pts], 1)
    pixels = sub[mask > 0]
    if pixels.size == 0:
        return 0.0, 0.0
    return float(pixels.mean() / 255.0), float(pixels.std() / 255.0)


def _score_candidate(
    quad: np.ndarray, gray: np.ndarray, bbox_in_crop: tuple
) -> tuple[float, dict]:
    """Score in [0, 10]; returns (-1, info) for hard rejects."""
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_area = max(1.0, (bx2 - bx1) * (by2 - by1))
    H, W = gray.shape[:2]

    # Hard rejects -----------------------------------------------------
    ar = _quad_aspect_ratio(quad)
    if ar < PLATE_AR_MIN_HARD or ar > PLATE_AR_MAX_HARD:
        return -1.0, {"reject": "ar", "ar": ar}

    qarea = _quad_area(quad)
    area_ratio = qarea / bbox_area
    if area_ratio < 0.25 or area_ratio > 1.20:
        return -1.0, {"reject": "size", "area_ratio": area_ratio}

    contain = _quad_inside_bbox_ratio(quad, bbox_in_crop)
    if contain < 0.80:
        return -1.0, {"reject": "overflow", "contain": contain}

    if (quad[:, 0].min() < -2 or quad[:, 1].min() < -2
            or quad[:, 0].max() > W + 2 or quad[:, 1].max() > H + 2):
        return -1.0, {"reject": "outside_crop"}

    # Sub-scores in [0, 1] ---------------------------------------------
    ar_score   = math.exp(-((ar - PLATE_AR_TARGET) ** 2) / (2 * 0.7 ** 2))
    size_score = math.exp(-((area_ratio - 0.75) ** 2) / (2 * 0.25 ** 2))

    bbox_cx = (bx1 + bx2) * 0.5
    bbox_cy = (by1 + by2) * 0.5
    diag    = math.hypot(bx2 - bx1, by2 - by1) or 1.0
    cx, cy  = _quad_center(quad)
    center_dist  = math.hypot(cx - bbox_cx, cy - bbox_cy) / diag
    center_score = math.exp(-(center_dist ** 2) / (2 * 0.18 ** 2))

    brightness, contrast = _quad_pixel_stats(quad, gray)
    bright_score   = max(0.0, min(1.0, (brightness - 0.20) / 0.60))
    contrast_score = min(1.0, contrast / 0.18)

    weighted = (
        2.5 * ar_score
      + 2.5 * contain
      + 1.5 * center_score
      + 1.5 * size_score
      + 1.0 * bright_score
      + 1.0 * contrast_score
    )
    return weighted, {
        "ar": ar,
        "contain": contain,
        "size_score": size_score,
        "center_score": center_score,
        "bright_score": bright_score,
        "contrast_score": contrast_score,
    }


# Edge-mask builders ---------------------------------------------------
def _build_edge_masks(gray: np.ndarray) -> list[np.ndarray]:
    """Multi-method binary masks: Canny ×3, Otsu ±, adaptive."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    masks: list[np.ndarray] = []
    for low, high in ((30, 120), (50, 150), (15, 80)):
        edges = cv2.Canny(blur, low, high)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        masks.append(edges)
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks.append(otsu)
    _, otsu_inv = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    masks.append(otsu_inv)
    masks.append(cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 5
    ))
    return masks


def _approxpoly_quads(masks: list[np.ndarray], bbox_in_crop: tuple) -> list[np.ndarray]:
    """4-point approxPolyDP candidates from each mask (no minAreaRect)."""
    cands: list[np.ndarray] = []
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_area = max(1.0, (bx2 - bx1) * (by2 - by1))
    for mask in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
            if cv2.contourArea(cnt) < bbox_area * 0.10:
                continue
            peri = cv2.arcLength(cnt, True)
            for eps in (0.02, 0.035, 0.05, 0.07):
                approx = cv2.approxPolyDP(cnt, eps * peri, True)
                if len(approx) == 4:
                    cands.append(_order_corners(approx.reshape(4, 2).astype(float)))
                    break
    return cands


def _minarearect_quads(
    masks: list[np.ndarray], bbox_in_crop: tuple, shrink: float = 0.06
) -> list[np.ndarray]:
    """Oriented bounding-box candidates (slightly shrunk) — last resort."""
    cands: list[np.ndarray] = []
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_area = max(1.0, (bx2 - bx1) * (by2 - by1))
    for mask in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            if cv2.contourArea(cnt) < bbox_area * 0.15:
                continue
            (cx, cy), (w, h), angle = cv2.minAreaRect(cnt)
            shrunk = ((cx, cy), (w * (1.0 - shrink), h * (1.0 - shrink)), angle)
            cands.append(_order_corners(cv2.boxPoints(shrunk).astype(float)))
    return cands


def _pick_best(
    cands: list[np.ndarray], gray: np.ndarray, bbox_in_crop: tuple
) -> tuple[np.ndarray | None, float, dict]:
    """Return best-scoring quad, or (None, -1, {}) if all hard-rejected."""
    best_score = -0.5
    best_quad: np.ndarray | None = None
    best_info: dict = {}
    for q in cands:
        score, info = _score_candidate(q, gray, bbox_in_crop)
        if score > best_score:
            best_score, best_quad, best_info = score, q, info
    return best_quad, best_score, best_info


# HoughLinesP corner detection ----------------------------------------
def _segment_angle_deg(seg) -> float:
    """Angle of a segment, mapped to [0, 180)."""
    x1, y1, x2, y2 = seg
    return math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180


def _segment_length(seg) -> float:
    x1, y1, x2, y2 = seg
    return math.hypot(x2 - x1, y2 - y1)


def _segment_midpoint(seg) -> tuple[float, float]:
    x1, y1, x2, y2 = seg
    return (x1 + x2) * 0.5, (y1 + y2) * 0.5


def _fit_line_segments(segments: list) -> tuple | None:
    """
    Fit a robust line through points sampled along all segments.
    Returns (vx, vy, x0, y0) — Hough/parametric form — or None.
    """
    if not segments:
        return None
    pts: list[list[float]] = []
    for seg in segments:
        x1, y1, x2, y2 = seg
        n = max(2, int(math.hypot(x2 - x1, y2 - y1) / 2.0))
        for t in np.linspace(0.0, 1.0, n):
            pts.append([x1 + t * (x2 - x1), y1 + t * (y2 - y1)])
    if len(pts) < 2:
        return None
    arr = np.array(pts, dtype=np.float32)
    line = cv2.fitLine(arr, cv2.DIST_HUBER, 0, 0.01, 0.01)
    vx, vy, x0, y0 = line.flatten()
    return float(vx), float(vy), float(x0), float(y0)


def _line_intersect(L1: tuple, L2: tuple) -> tuple[float, float] | None:
    """Intersect two parametric lines (vx, vy, x0, y0). None if parallel."""
    vx1, vy1, x1, y1 = L1
    vx2, vy2, x2, y2 = L2
    det = vx1 * vy2 - vy1 * vx2
    if abs(det) < 1e-6:
        return None
    t = ((x2 - x1) * vy2 - (y2 - y1) * vx2) / det
    return x1 + t * vx1, y1 + t * vy1


def _corners_from_houghlines(
    gray: np.ndarray, bbox_in_crop: tuple
) -> np.ndarray | None:
    """
    Detect plate borders with HoughLinesP, cluster segments into 4
    families (top/bottom/left/right) by angle + position, fit a robust
    line per family, intersect adjacent lines → 4 real plate corners.

    Returns an ordered [tl, tr, br, bl] quad in crop-pixel coords, or
    None if any of the 4 families is missing or the resulting quad is
    geometrically implausible (AR / area / overflow checks).
    """
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_w    = max(1.0, bx2 - bx1)
    bbox_h    = max(1.0, by2 - by1)
    bbox_diag = math.hypot(bbox_w, bbox_h)
    bbox_cx   = (bx1 + bx2) * 0.5
    bbox_cy   = (by1 + by2) * 0.5

    # Combined edge map — union of two Canny scales
    blur  = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.bitwise_or(cv2.Canny(blur, 30, 120), cv2.Canny(blur, 50, 150))
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)

    min_line_length = max(15, int(bbox_w * 0.20))
    max_line_gap    = max(5,  int(bbox_w * 0.05))
    threshold       = max(20, int(bbox_diag * 0.10))
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold,
        minLineLength=min_line_length, maxLineGap=max_line_gap,
    )
    if lines is None:
        return None
    segments = [tuple(float(v) for v in l[0]) for l in lines]

    # Keep only segments whose midpoint is near the YOLO bbox
    margin = max(8.0, 0.10 * bbox_diag)
    segments = [
        s for s in segments
        if (bx1 - margin) <= _segment_midpoint(s)[0] <= (bx2 + margin)
        and (by1 - margin) <= _segment_midpoint(s)[1] <= (by2 + margin)
    ]
    if len(segments) < 4:
        return None

    # Classify by angle (perspective-tolerant: ±25° / ±25° windows)
    horiz, vert = [], []
    for seg in segments:
        a = _segment_angle_deg(seg)
        if a <= 25 or a >= 155:
            horiz.append(seg)
        elif 65 <= a <= 115:
            vert.append(seg)

    # Sub-classify by position around the bbox centre
    top    = [s for s in horiz if _segment_midpoint(s)[1] <  bbox_cy]
    bottom = [s for s in horiz if _segment_midpoint(s)[1] >= bbox_cy]
    left   = [s for s in vert  if _segment_midpoint(s)[0] <  bbox_cx]
    right  = [s for s in vert  if _segment_midpoint(s)[0] >= bbox_cx]

    if not (top and bottom and left and right):
        return None

    # Keep the longest segments per family (these dominate the line fit)
    def _top_n(L, n=6):
        return sorted(L, key=_segment_length, reverse=True)[:n]
    top, bottom, left, right = _top_n(top), _top_n(bottom), _top_n(left), _top_n(right)

    # Fit one robust line per family
    L_top    = _fit_line_segments(top)
    L_bottom = _fit_line_segments(bottom)
    L_left   = _fit_line_segments(left)
    L_right  = _fit_line_segments(right)
    if not all((L_top, L_bottom, L_left, L_right)):
        return None

    # Intersect adjacent lines → 4 real corners
    tl = _line_intersect(L_top,    L_left)
    tr = _line_intersect(L_top,    L_right)
    br = _line_intersect(L_bottom, L_right)
    bl = _line_intersect(L_bottom, L_left)
    if not all((tl, tr, br, bl)):
        return None

    quad = _order_corners(np.array([tl, tr, br, bl], dtype=float))

    # Validate the resulting projective quad
    H, W = gray.shape[:2]
    ar = _quad_aspect_ratio(quad)
    if ar < PLATE_AR_MIN_HARD or ar > PLATE_AR_MAX_HARD:
        return None
    bbox_area = bbox_w * bbox_h
    area_ratio = _quad_area(quad) / max(1.0, bbox_area)
    if area_ratio < 0.20 or area_ratio > 1.30:
        return None
    if _quad_inside_bbox_ratio(quad, bbox_in_crop) < 0.78:
        return None
    if (quad[:, 0].min() < -2 or quad[:, 1].min() < -2
            or quad[:, 0].max() > W + 2 or quad[:, 1].max() > H + 2):
        return None

    return quad


def _tightened_bbox_quad(
    bbox_in_crop: tuple, sx_frac: float = 0.04, sy_frac: float = 0.08
) -> np.ndarray:
    """Axis-aligned quad slightly inside the YOLO bbox (safe baseline)."""
    bx1, by1, bx2, by2 = bbox_in_crop
    sx = (bx2 - bx1) * sx_frac
    sy = (by2 - by1) * sy_frac
    return np.array([
        [bx1 + sx, by1 + sy],
        [bx2 - sx, by1 + sy],
        [bx2 - sx, by2 - sy],
        [bx1 + sx, by2 - sy],
    ], dtype=float)


def refine_corners(img_rgb: np.ndarray, bbox: dict, pad: float = 0.20) -> list[dict] | None:
    """
    Multi-stage corner detection inside the YOLO bbox.

    Order of preference:
      1. HoughLinesP — detect edge segments, cluster into 4 families
         (top / bottom / left / right), fit one line per family,
         intersect adjacent lines → 4 real plate corners. Yields a
         **true projective quadrilateral** matching the actual plate
         even seen in 3/4 view.
      2. approxPolyDP 4-point on the best contour from several
         edge/threshold pipelines, scored on AR / containment / etc.
      3. minAreaRect oriented box (slightly shrunk) — last resort,
         only when no contour exposes 4 clean corners.
      4. Tightened YOLO bbox — ultimate fallback so we never overflow.

    Returns ordered [tl, tr, br, bl] normalised corners, or None when
    the crop is too small to process.
    """
    H, W = img_rgb.shape[:2]
    pw = (bbox["x2"] - bbox["x1"]) * pad
    ph = (bbox["y2"] - bbox["y1"]) * pad
    cx1 = int(max(0, (bbox["x1"] - pw) * W))
    cy1 = int(max(0, (bbox["y1"] - ph) * H))
    cx2 = int(min(W, (bbox["x2"] + pw) * W))
    cy2 = int(min(H, (bbox["y2"] + ph) * H))

    crop = img_rgb[cy1:cy2, cx1:cx2]
    ch, cw = crop.shape[:2]
    if cw < 20 or ch < 8:
        return None

    bbox_in_crop = (
        bbox["x1"] * W - cx1,
        bbox["y1"] * H - cy1,
        bbox["x2"] * W - cx1,
        bbox["y2"] * H - cy1,
    )
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)

    quad: np.ndarray | None = None
    method: str = ""

    # 1. HoughLinesP — 4 line intersections (true projective quad)
    quad = _corners_from_houghlines(gray, bbox_in_crop)
    if quad is not None:
        method = "hough_lines"

    masks: list[np.ndarray] | None = None

    # 2. approxPolyDP 4-point on best contour, scored
    if quad is None:
        masks = _build_edge_masks(gray)
        cands = _approxpoly_quads(masks, bbox_in_crop)
        best, score, _ = _pick_best(cands, gray, bbox_in_crop)
        if best is not None:
            quad   = best
            method = f"approx_poly score={score:.2f}"

    # 3. minAreaRect (last resort, slightly shrunk)
    if quad is None:
        if masks is None:
            masks = _build_edge_masks(gray)
        cands = _minarearect_quads(masks, bbox_in_crop, shrink=0.06)
        best, score, _ = _pick_best(cands, gray, bbox_in_crop)
        if best is not None:
            quad   = best
            method = f"min_area_rect score={score:.2f}"

    # 4. Ultimate fallback — tightened YOLO bbox
    if quad is None:
        quad   = _tightened_bbox_quad(bbox_in_crop, 0.04, 0.08)
        method = "tightened_bbox"

    logger.info(
        f"Refinement via {method} ar={_quad_aspect_ratio(quad):.2f} "
        f"contain={_quad_inside_bbox_ratio(quad, bbox_in_crop):.2f}"
    )

    # Map crop-relative pixels → normalised full-image coords
    corners = []
    for pt in quad:
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
