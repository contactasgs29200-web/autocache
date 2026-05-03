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
def _build_edge_masks(gray: np.ndarray) -> list[tuple[str, np.ndarray]]:
    """Multi-method binary masks: Canny ×3, Otsu ±, adaptive.
    Returns [(method_name, mask), ...] so candidates can be tagged."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    out: list[tuple[str, np.ndarray]] = []
    for low, high in ((30, 120), (50, 150), (15, 80)):
        edges = cv2.Canny(blur, low, high)
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        out.append((f"canny_{low}_{high}", edges))
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    out.append(("otsu", otsu))
    _, otsu_inv = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    out.append(("otsu_inv", otsu_inv))
    out.append((
        "adaptive",
        cv2.adaptiveThreshold(
            blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 5
        ),
    ))
    return out


def _approxpoly_candidates(
    named_masks: list[tuple[str, np.ndarray]], bbox_in_crop: tuple
) -> list[tuple[np.ndarray, str]]:
    """4-point approxPolyDP candidates with method-name tags."""
    out: list[tuple[np.ndarray, str]] = []
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_area = max(1.0, (bx2 - bx1) * (by2 - by1))
    for mask_name, mask in named_masks:
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
                    quad = _order_corners(approx.reshape(4, 2).astype(float))
                    out.append((quad, f"approx_poly:{mask_name}:eps={eps}"))
                    break
    return out


def _minarearect_candidates(
    named_masks: list[tuple[str, np.ndarray]],
    bbox_in_crop: tuple,
    shrink: float = 0.06,
) -> list[tuple[np.ndarray, str]]:
    """Oriented-rectangle candidates (slightly shrunk) with method-name tags."""
    out: list[tuple[np.ndarray, str]] = []
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_area = max(1.0, (bx2 - bx1) * (by2 - by1))
    for mask_name, mask in named_masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            if cv2.contourArea(cnt) < bbox_area * 0.15:
                continue
            (cx, cy), (w, h), angle = cv2.minAreaRect(cnt)
            shrunk = ((cx, cy), (w * (1.0 - shrink), h * (1.0 - shrink)), angle)
            quad = _order_corners(cv2.boxPoints(shrunk).astype(float))
            out.append((quad, f"min_area_rect:{mask_name}"))
    return out


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


# ---------------------------------------------------------------------------
# Plate-aware specialized candidate generators
# ---------------------------------------------------------------------------

def _fit_line_through_points(points: list) -> tuple | None:
    """Fit a robust line through (x, y) points → (vx, vy, x0, y0); None if < 2."""
    if len(points) < 2:
        return None
    arr = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
    line = cv2.fitLine(arr, cv2.DIST_HUBER, 0, 0.01, 0.01)
    vx, vy, x0, y0 = line.flatten()
    return float(vx), float(vy), float(x0), float(y0)


def _detect_top_bottom_lines(
    gray: np.ndarray, bbox_in_crop: tuple
) -> tuple:
    """
    Hough-based top + bottom plate borders (parametric form).
    Returns (L_top, L_bottom) or (None, None) if either side is missing.
    """
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_w    = max(1.0, bx2 - bx1)
    bbox_diag = math.hypot(bx2 - bx1, by2 - by1)
    bbox_cy   = (by1 + by2) * 0.5

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
        return None, None

    margin = max(8.0, 0.10 * bbox_diag)
    segments = []
    for ln in lines:
        s = tuple(float(v) for v in ln[0])
        mx, my = _segment_midpoint(s)
        if (bx1 - margin) <= mx <= (bx2 + margin) and (by1 - margin) <= my <= (by2 + margin):
            segments.append(s)

    horiz = [s for s in segments
             if _segment_angle_deg(s) <= 25 or _segment_angle_deg(s) >= 155]
    top    = [s for s in horiz if _segment_midpoint(s)[1] <  bbox_cy]
    bottom = [s for s in horiz if _segment_midpoint(s)[1] >= bbox_cy]
    if not top or not bottom:
        return None, None

    top    = sorted(top,    key=_segment_length, reverse=True)[:6]
    bottom = sorted(bottom, key=_segment_length, reverse=True)[:6]
    return _fit_line_segments(top), _fit_line_segments(bottom)


def _find_lateral_boundary_points(
    crop_rgb: np.ndarray, gray: np.ndarray, bbox_in_crop: tuple
) -> tuple[list, list]:
    """
    Collect 2D points along the actual left / right plate edges.
    Sources, in decreasing strength:
      • outer column of blue EU bands (very strong if visible)
      • leftmost / rightmost columns of the bright plate body
      • horizontal extent of the dark-character row (with a small margin)
    Returns (left_pts, right_pts) — each a list of [x, y] in crop pixels.
    """
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_w = max(1.0, bx2 - bx1)
    bbox_h = max(1.0, by2 - by1)
    H, W   = gray.shape[:2]

    rx1 = int(max(0, bx1 - bbox_w * 0.06))
    ry1 = int(max(0, by1 - bbox_h * 0.10))
    rx2 = int(min(W, bx2 + bbox_w * 0.06))
    ry2 = int(min(H, by2 + bbox_h * 0.10))
    if rx2 - rx1 < 10 or ry2 - ry1 < 6:
        return [], []

    sub_rgb  = crop_rgb[ry1:ry2, rx1:rx2]
    sub_gray = gray[ry1:ry2, rx1:rx2]
    sub_h, sub_w = sub_gray.shape[:2]

    hsv = cv2.cvtColor(sub_rgb, cv2.COLOR_RGB2HSV)
    h_chan, s_chan, v_chan = cv2.split(hsv)

    # ---- bright + desaturated plate-body mask ----
    body = ((v_chan > 130) & (s_chan < 70)).astype(np.uint8) * 255
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((3, 7), np.uint8))
    body = cv2.morphologyEx(body, cv2.MORPH_OPEN,  np.ones((3, 3), np.uint8))

    body_bbox = None
    n_body, _, stats_body, _ = cv2.connectedComponentsWithStats(body, 8)
    if n_body > 1:
        idx = 1 + int(stats_body[1:, cv2.CC_STAT_AREA].argmax())
        if stats_body[idx, cv2.CC_STAT_AREA] > 0.10 * (sub_h * sub_w):
            x  = int(stats_body[idx, cv2.CC_STAT_LEFT])
            y  = int(stats_body[idx, cv2.CC_STAT_TOP])
            ww = int(stats_body[idx, cv2.CC_STAT_WIDTH])
            hh = int(stats_body[idx, cv2.CC_STAT_HEIGHT])
            body_bbox = (x, y, x + ww, y + hh)

    # ---- blue EU-band mask ----
    blue = ((h_chan >= 95) & (h_chan <= 135)
            & (s_chan > 70) & (v_chan > 40)).astype(np.uint8) * 255
    blue = cv2.morphologyEx(blue, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    blue_left, blue_right = None, None
    n_blue, _, stats_blue, _ = cv2.connectedComponentsWithStats(blue, 8)
    for i in range(1, n_blue):
        bx = int(stats_blue[i, cv2.CC_STAT_LEFT])
        by = int(stats_blue[i, cv2.CC_STAT_TOP])
        bw = int(stats_blue[i, cv2.CC_STAT_WIDTH])
        bh = int(stats_blue[i, cv2.CC_STAT_HEIGHT])
        if bh < 0.40 * sub_h or bw > 0.25 * sub_w:
            continue
        cx_blob = bx + bw / 2.0
        if cx_blob < sub_w * 0.30 and (blue_left is None or bx < blue_left[0]):
            blue_left = (bx, by, bx + bw, by + bh)
        elif cx_blob > sub_w * 0.70 and (blue_right is None or (bx + bw) > blue_right[2]):
            blue_right = (bx, by, bx + bw, by + bh)

    # ---- dark-character mask within the body ----
    dark = (sub_gray < 110).astype(np.uint8) * 255
    if body_bbox is not None:
        bm = np.zeros_like(dark)
        bm[body_bbox[1]:body_bbox[3], body_bbox[0]:body_bbox[2]] = 255
        dark = cv2.bitwise_and(dark, bm)
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

    text_blobs = []
    n_t, _, stats_t, _ = cv2.connectedComponentsWithStats(dark, 8)
    for i in range(1, n_t):
        tx = int(stats_t[i, cv2.CC_STAT_LEFT])
        ty = int(stats_t[i, cv2.CC_STAT_TOP])
        tw = int(stats_t[i, cv2.CC_STAT_WIDTH])
        th = int(stats_t[i, cv2.CC_STAT_HEIGHT])
        if th < 0.25 * sub_h or th > 0.95 * sub_h:
            continue
        if tw > 0.18 * sub_w or tw < 0.02 * sub_w:
            continue
        if th < 0.8 * tw:
            continue
        text_blobs.append((tx, ty, tx + tw, ty + th))

    left_pts:  list = []
    right_pts: list = []

    # Body extents — 5 sample rows across height
    if body_bbox is not None:
        bx0, by0, bx_end, by_end = body_bbox
        for y_frac in (0.20, 0.35, 0.50, 0.65, 0.80):
            y = int(by0 + y_frac * (by_end - by0))
            if 0 <= y < sub_h:
                row = body[y]
                xs = np.where(row > 0)[0]
                if xs.size > 0:
                    left_pts.append([rx1 + float(xs.min()), ry1 + float(y)])
                    right_pts.append([rx1 + float(xs.max()), ry1 + float(y)])

    # Blue-band outer columns (very strong cue)
    if blue_left is not None:
        bx0, by0, _, by_end = blue_left
        for yy in (by0, (by0 + by_end) * 0.5, by_end):
            left_pts.append([rx1 + float(bx0), ry1 + float(yy)])
    if blue_right is not None:
        _, by0, bx_end, by_end = blue_right
        for yy in (by0, (by0 + by_end) * 0.5, by_end):
            right_pts.append([rx1 + float(bx_end), ry1 + float(yy)])

    # Text horizontal extents — chars span ~78% of plate width → ≈13% margin
    if len(text_blobs) >= 3:
        text_blobs.sort(key=lambda b: b[0])
        leftmost  = text_blobs[0]
        rightmost = text_blobs[-1]
        text_top  = min(b[1] for b in text_blobs)
        text_bot  = max(b[3] for b in text_blobs)
        chars_w   = max(1.0, rightmost[2] - leftmost[0])
        margin_x  = chars_w * 0.13 / 0.78
        for yy in (text_top, (text_top + text_bot) * 0.5, text_bot):
            left_pts.append([rx1 + float(leftmost[0])  - margin_x, ry1 + float(yy)])
            right_pts.append([rx1 + float(rightmost[2]) + margin_x, ry1 + float(yy)])

    return left_pts, right_pts


def _hybrid_plate_quad(
    crop_rgb: np.ndarray, gray: np.ndarray, bbox_in_crop: tuple
) -> np.ndarray | None:
    """
    True projective plate quad combining:
      • top/bottom borders detected via Hough lines (often reliable)
      • left/right borders inferred from plate content (blue bands,
        bright body, character extents)
    Sides may tilt independently — NOT axis-aligned.
    """
    L_top, L_bottom = _detect_top_bottom_lines(gray, bbox_in_crop)
    if L_top is None or L_bottom is None:
        return None

    left_pts, right_pts = _find_lateral_boundary_points(crop_rgb, gray, bbox_in_crop)
    if len(left_pts) < 3 or len(right_pts) < 3:
        return None

    L_left  = _fit_line_through_points(left_pts)
    L_right = _fit_line_through_points(right_pts)
    if L_left is None or L_right is None:
        return None

    tl = _line_intersect(L_top,    L_left)
    tr = _line_intersect(L_top,    L_right)
    br = _line_intersect(L_bottom, L_right)
    bl = _line_intersect(L_bottom, L_left)
    if not all((tl, tr, br, bl)):
        return None

    quad = _order_corners(np.array([tl, tr, br, bl], dtype=float))

    H, W = gray.shape[:2]
    if (quad[:, 0].min() < -2 or quad[:, 1].min() < -2
            or quad[:, 0].max() > W + 2 or quad[:, 1].max() > H + 2):
        return None
    ar = _quad_aspect_ratio(quad)
    if ar < PLATE_AR_MIN_HARD or ar > PLATE_AR_MAX_HARD:
        return None
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_area = max(1.0, (bx2 - bx1) * (by2 - by1))
    if not (0.20 <= _quad_area(quad) / bbox_area <= 1.30):
        return None
    if _quad_inside_bbox_ratio(quad, bbox_in_crop) < 0.78:
        return None
    return quad


def _plate_edges_candidates(
    crop_rgb: np.ndarray, bbox_in_crop: tuple
) -> list[tuple[np.ndarray, str]]:
    """HSV bright + desaturated plate-body mask → contour → 4-point polygon."""
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_w = max(1.0, bx2 - bx1)
    bbox_h = max(1.0, by2 - by1)
    bbox_area = bbox_w * bbox_h
    cx0 = (bx1 + bx2) * 0.5
    cy0 = (by1 + by2) * 0.5

    hsv = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2HSV)
    h_chan, s_chan, v_chan = cv2.split(hsv)

    out: list[tuple[np.ndarray, str]] = []
    for v_thr, s_thr in ((130, 70), (150, 60), (110, 90)):
        mask = ((v_chan > v_thr) & (s_chan < s_thr)).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 7), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:4]:
            area = cv2.contourArea(cnt)
            if area < 0.20 * bbox_area or area > 2.0 * bbox_area:
                continue
            x, y, w_c, h_c = cv2.boundingRect(cnt)
            cx_c, cy_c = x + w_c * 0.5, y + h_c * 0.5
            if abs(cx_c - cx0) > bbox_w * 0.40 or abs(cy_c - cy0) > bbox_h * 0.40:
                continue
            peri = cv2.arcLength(cnt, True)
            for eps in (0.02, 0.035, 0.05, 0.07):
                approx = cv2.approxPolyDP(cnt, eps * peri, True)
                if len(approx) == 4:
                    quad = _order_corners(approx.reshape(4, 2).astype(float))
                    out.append((quad, f"plate_edges:v={v_thr}_s={s_thr}:eps={eps}"))
                    break
    return out


def _blue_bands_candidates(
    crop_rgb: np.ndarray, bbox_in_crop: tuple
) -> list[tuple[np.ndarray, str]]:
    """HSV blue blobs at left+right of plate → axis-aligned plate quad."""
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_w = max(1.0, bx2 - bx1)
    bbox_h = max(1.0, by2 - by1)
    H, W = crop_rgb.shape[:2]

    rx1 = int(max(0, bx1 - bbox_w * 0.05))
    ry1 = int(max(0, by1 - bbox_h * 0.05))
    rx2 = int(min(W, bx2 + bbox_w * 0.05))
    ry2 = int(min(H, by2 + bbox_h * 0.05))
    if rx2 - rx1 < 10 or ry2 - ry1 < 6:
        return []

    sub = crop_rgb[ry1:ry2, rx1:rx2]
    hsv = cv2.cvtColor(sub, cv2.COLOR_RGB2HSV)
    h_chan, s_chan, v_chan = cv2.split(hsv)
    sub_h, sub_w = sub.shape[:2]

    blue = ((h_chan >= 95) & (h_chan <= 135)
            & (s_chan > 70) & (v_chan > 40)).astype(np.uint8) * 255
    blue = cv2.morphologyEx(blue, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    n, _, stats, _ = cv2.connectedComponentsWithStats(blue, 8)
    left_blob, right_blob = None, None
    for i in range(1, n):
        bx = int(stats[i, cv2.CC_STAT_LEFT])
        by = int(stats[i, cv2.CC_STAT_TOP])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        if bh < 0.40 * sub_h or bw > 0.25 * sub_w:
            continue
        cx_blob = bx + bw / 2.0
        if cx_blob < sub_w * 0.30 and (left_blob is None or bx < left_blob[0]):
            left_blob = (bx, by, bx + bw, by + bh)
        elif cx_blob > sub_w * 0.70 and (right_blob is None or (bx + bw) > right_blob[2]):
            right_blob = (bx, by, bx + bw, by + bh)

    if left_blob is None or right_blob is None:
        return []
    x_left  = rx1 + left_blob[0]
    x_right = rx1 + right_blob[2]
    y_top   = ry1 + min(left_blob[1], right_blob[1])
    y_bot   = ry1 + max(left_blob[3], right_blob[3])
    pad_y   = 0.05 * (y_bot - y_top)
    y_top   = max(0, y_top - pad_y)
    y_bot   = min(H, y_bot + pad_y)
    quad = np.array([
        [x_left,  y_top],
        [x_right, y_top],
        [x_right, y_bot],
        [x_left,  y_bot],
    ], dtype=float)
    return [(quad, "blue_bands:both")]


def _text_band_candidates(
    gray: np.ndarray, bbox_in_crop: tuple
) -> list[tuple[np.ndarray, str]]:
    """Otsu-inverse → dark-character blobs → tight bbox + plate margin."""
    bx1, by1, bx2, by2 = bbox_in_crop
    bbox_w = max(1.0, bx2 - bx1)
    bbox_h = max(1.0, by2 - by1)
    H, W = gray.shape[:2]

    rx1 = int(max(0, bx1 - bbox_w * 0.05))
    ry1 = int(max(0, by1 - bbox_h * 0.05))
    rx2 = int(min(W, bx2 + bbox_w * 0.05))
    ry2 = int(min(H, by2 + bbox_h * 0.05))
    sub = gray[ry1:ry2, rx1:rx2]
    sub_h, sub_w = sub.shape[:2]
    if sub_w < 10 or sub_h < 6:
        return []

    blur = cv2.GaussianBlur(sub, (3, 3), 0)
    _, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))

    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    blobs = []
    for i in range(1, n):
        x  = int(stats[i, cv2.CC_STAT_LEFT])
        y  = int(stats[i, cv2.CC_STAT_TOP])
        ww = int(stats[i, cv2.CC_STAT_WIDTH])
        hh = int(stats[i, cv2.CC_STAT_HEIGHT])
        if hh < 0.30 * sub_h or hh > 0.90 * sub_h:
            continue
        if ww > 0.18 * sub_w or ww < 0.02 * sub_w:
            continue
        if hh < 0.8 * ww:
            continue
        blobs.append((x, y, x + ww, y + hh))

    if len(blobs) < 4:
        return []
    centers_y = np.array([(b[1] + b[3]) * 0.5 for b in blobs])
    median_y = float(np.median(centers_y))
    blobs = [b for b, cy in zip(blobs, centers_y) if abs(cy - median_y) < sub_h * 0.25]
    if len(blobs) < 4:
        return []

    x_min = min(b[0] for b in blobs); x_max = max(b[2] for b in blobs)
    y_min = min(b[1] for b in blobs); y_max = max(b[3] for b in blobs)
    chars_w  = max(1.0, x_max - x_min)
    margin_x = chars_w * 0.13 / 0.78
    margin_y = (y_max - y_min) * 0.18

    qx1 = max(0, rx1 + x_min - margin_x)
    qy1 = max(0, ry1 + y_min - margin_y)
    qx2 = min(W, rx1 + x_max + margin_x)
    qy2 = min(H, ry1 + y_max + margin_y)
    quad = np.array([
        [qx1, qy1], [qx2, qy1], [qx2, qy2], [qx1, qy2],
    ], dtype=float)
    return [(quad, f"text_band:n={len(blobs)}")]


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


def refine_corners(
    img_rgb: np.ndarray, bbox: dict, pad: float = 0.10
) -> tuple[list[dict] | None, dict]:
    """
    Multi-stage corner detection with full candidate-debug payload.

    Selection priority (the chosen candidate becomes the final quad):
      1. HoughLinesP intersections (true projective quad)
      2. approxPolyDP 4-point — best-scoring among edge/threshold masks
      3. minAreaRect oriented box (slightly shrunk) — last resort
      4. Tightened YOLO bbox — ultimate fallback

    Every candidate is scored on the same scale (`_score_candidate`) and
    tagged with the method that produced it. The top 5 by score (plus
    the chosen one if it's not already in the top 5) are returned in
    `debug.candidates` so the frontend can visualise why a particular
    quad won.

    Returns `(corners, debug)`:
      corners = [{x,y}, …] × 4 ordered [tl, tr, br, bl] in image-
                normalised coords, or None when the crop is too small.
      debug   = {
        "method":           method tag of chosen quad,
        "total_candidates": int,
        "candidates":       [
          {
            "corners":    list[dict] × 4 normalised,
            "score":      float,
            "sub_scores": dict (raw + normalised sub-criteria),
            "method":     str,
            "is_final":   bool,
          },
          …
        ],
      }
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
        return None, {"method": "skipped_small_crop", "candidates": [], "total_candidates": 0}

    bbox_in_crop = (
        bbox["x1"] * W - cx1,
        bbox["y1"] * H - cy1,
        bbox["x2"] * W - cx1,
        bbox["y2"] * H - cy1,
    )
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)

    # ---------- Collect every candidate (each tagged) ----------
    all_cands: list[dict] = []   # {quad, score, sub_scores, method}

    def _add(quad: np.ndarray, method: str) -> None:
        score, info = _score_candidate(quad, gray, bbox_in_crop)
        all_cands.append({
            "quad": quad, "score": score, "sub_scores": info, "method": method,
        })

    # 1. Hybrid plate-aware projective quad (top + bottom from Hough,
    #    left + right from plate content — sides may tilt independently)
    hybrid_quad = _hybrid_plate_quad(crop, gray, bbox_in_crop)
    if hybrid_quad is not None:
        _add(hybrid_quad, "hybrid_plate_quad")

    # 2. HoughLinesP all-four-sides intersections
    hough_quad = _corners_from_houghlines(gray, bbox_in_crop)
    if hough_quad is not None:
        _add(hough_quad, "hough_lines")

    # 3. Plate-aware specialized candidates (color/text-driven)
    for q, m in _plate_edges_candidates(crop, bbox_in_crop):
        _add(q, m)
    for q, m in _blue_bands_candidates(crop, bbox_in_crop):
        _add(q, m)
    for q, m in _text_band_candidates(gray, bbox_in_crop):
        _add(q, m)

    # 4 & 5. Generic approxPolyDP + minAreaRect from each edge/threshold mask
    named_masks = _build_edge_masks(gray)
    for q, m in _approxpoly_candidates(named_masks, bbox_in_crop):
        _add(q, m)
    for q, m in _minarearect_candidates(named_masks, bbox_in_crop, shrink=0.06):
        _add(q, m)

    # 6. Tightened YOLO bbox baselines (last-resort fallback)
    for sf, hf in ((0.04, 0.08), (0.07, 0.12)):
        _add(_tightened_bbox_quad(bbox_in_crop, sf, hf),
             f"tightened_bbox:{sf:.2f}_{hf:.2f}")

    # ---------- Selection logic (priority chain) ----------
    chosen: dict | None = None

    # 1) Hybrid plate-aware projective quad (top priority — true projective
    #    geometry recovered from plate content)
    for c in all_cands:
        if c["method"] == "hybrid_plate_quad" and c["score"] >= 0:
            chosen = c
            break

    # 2) HoughLinesP all-four-sides intersection
    if chosen is None:
        for c in all_cands:
            if c["method"] == "hough_lines" and c["score"] >= 0:
                chosen = c
                break

    # 3) Best-scoring plate-aware specialized candidate
    if chosen is None:
        spec = [
            c for c in all_cands
            if c["score"] >= 0
            and (c["method"].startswith("plate_edges")
                 or c["method"].startswith("blue_bands")
                 or c["method"].startswith("text_band"))
        ]
        if spec:
            chosen = max(spec, key=lambda c: c["score"])

    # 4) Best-scoring approxPolyDP
    if chosen is None:
        approx = [c for c in all_cands
                  if c["method"].startswith("approx_poly") and c["score"] >= 0]
        if approx:
            chosen = max(approx, key=lambda c: c["score"])

    # 5) Best-scoring minAreaRect
    if chosen is None:
        rects = [c for c in all_cands
                 if c["method"].startswith("min_area_rect") and c["score"] >= 0]
        if rects:
            chosen = max(rects, key=lambda c: c["score"])

    # 6) Tightened bbox — last-resort fallback (always passable)
    if chosen is None:
        bbs = [c for c in all_cands if c["method"].startswith("tightened_bbox")]
        if bbs:
            chosen = max(bbs, key=lambda c: c["score"])

    # 5) Ultimate forced fallback
    if chosen is None:
        forced = _tightened_bbox_quad(bbox_in_crop, 0.04, 0.08)
        score, info = _score_candidate(forced, gray, bbox_in_crop)
        chosen = {
            "quad": forced, "score": score, "sub_scores": info,
            "method": "tightened_bbox_forced",
        }
        all_cands.append(chosen)

    chosen["is_final"] = True

    # ---------- Build debug payload ----------
    # Keep the chosen quad + only the 3 best alternative candidates
    # to reduce visual noise on the frontend.
    sorted_cands = sorted(all_cands, key=lambda c: c["score"], reverse=True)
    alt_n = [c for c in sorted_cands if c is not chosen][:3]
    top_n = [chosen] + alt_n

    def _quad_to_norm(q: np.ndarray) -> list[dict]:
        return [
            {"x": round(float(cx1 + p[0]) / W, 4),
             "y": round(float(cy1 + p[1]) / H, 4)}
            for p in q
        ]

    def _round_subs(d: dict) -> dict:
        return {
            k: (round(float(v), 3) if isinstance(v, (int, float)) else v)
            for k, v in d.items()
        }

    debug = {
        "method": chosen["method"],
        "total_candidates": len(all_cands),
        "candidates": [
            {
                "corners":    _quad_to_norm(c["quad"]),
                "score":      round(float(c["score"]), 3),
                "sub_scores": _round_subs(c["sub_scores"]),
                "method":     c["method"],
                "is_final":   c.get("is_final", False),
            }
            for c in top_n
        ],
    }

    final_corners = _quad_to_norm(chosen["quad"])

    logger.info(
        f"Refinement via {chosen['method']} score={chosen['score']:.2f} "
        f"ar={_quad_aspect_ratio(chosen['quad']):.2f} "
        f"contain={_quad_inside_bbox_ratio(chosen['quad'], bbox_in_crop):.2f} "
        f"({len(all_cands)} candidates total, top {len(top_n)} returned)"
    )

    return final_corners, debug


# ---------------------------------------------------------------------------
# Default automatic source: bbox_stable (axis-aligned, slight padding)
# ---------------------------------------------------------------------------

# Until a real keypoint model is deployed, the default automatic source
# for the 4 plate corners is the YOLO bbox itself with a small inward
# pad. OpenCV refinement (`refine_corners`) still runs for diagnostics
# and is exposed in `debug`, but it is NOT used as the final source
# unless the strict quality gate promotes it AND `ALLOW_OPENCV_PROMOTION`
# is True. Flip this flag once the gate is provably reliable.
ALLOW_OPENCV_PROMOTION = False


def _bbox_stable_corners(
    bbox: dict, pad_frac: float = 0.03
) -> list[dict]:
    """
    Stable axis-aligned 4-corner quad derived from the YOLO bbox with a
    slight inward padding (default 3%). Always succeeds.

    Returns corners in canonical order [tl, tr, br, bl], normalised to
    image coordinates — the same shape as keypoints/OpenCV corners.
    """
    w  = bbox["x2"] - bbox["x1"]
    h  = bbox["y2"] - bbox["y1"]
    px = w * pad_frac
    py = h * pad_frac
    return [
        {"x": round(bbox["x1"] + px, 4), "y": round(bbox["y1"] + py, 4)},  # tl
        {"x": round(bbox["x2"] - px, 4), "y": round(bbox["y1"] + py, 4)},  # tr
        {"x": round(bbox["x2"] - px, 4), "y": round(bbox["y2"] - py, 4)},  # br
        {"x": round(bbox["x1"] + px, 4), "y": round(bbox["y2"] - py, 4)},  # bl
    ]


def _opencv_passes_strict_gate(
    corners: list[dict] | None, refine_debug: dict | None
) -> tuple[bool, str]:
    """
    Decide whether an OpenCV refinement result is trustworthy enough to
    override `bbox_stable` as the final source.

    Strict on purpose — better to fall back to a clean bbox quad than to
    ship a wrong perspective. Returns (passed, reason). `reason` is a
    short tag useful for telemetry / debug overlay even on success.

    Whitelisted methods only — `min_area_rect`, `approx_poly` and
    `tightened_bbox` never pass: rectangle-oriented quads and grille-
    catching contours are precisely the failure modes that pushed us
    toward `bbox_stable` in the first place.
    """
    if not corners or len(corners) != 4 or not refine_debug:
        return False, "no_corners"

    method = refine_debug.get("method", "") or ""
    trusted_prefixes = (
        "hybrid_plate_quad", "hough_lines",
        "plate_edges", "blue_bands", "text_band",
    )
    if not any(method.startswith(p) for p in trusted_prefixes):
        return False, f"untrusted_method:{method.split(':')[0] or 'unknown'}"

    chosen = next(
        (c for c in (refine_debug.get("candidates") or []) if c.get("is_final")),
        None,
    )
    if not chosen:
        return False, "no_chosen_in_debug"

    sub = chosen.get("sub_scores") or {}
    ar = sub.get("ar")
    if ar is None or ar < 4.0 or ar > 5.5:
        return False, f"ar_out_of_range:{ar}"
    if (sub.get("contain") or 0) < 0.92:
        return False, "contain_below_0.92"
    if (sub.get("center_score") or 0) < 0.70:
        return False, "center_score_below_0.70"
    if (sub.get("size_score") or 0) < 0.70:
        return False, "size_score_below_0.70"

    return True, "passed"


# ---------------------------------------------------------------------------
# Keypoint extraction (YOLOv8-pose direct corners)
# ---------------------------------------------------------------------------

def _model_task(model: YOLO) -> str:
    """Return 'pose', 'detect', etc. for a loaded ultralytics model."""
    try:
        return getattr(model, "task", None) or "detect"
    except Exception:
        return "detect"


def _keypoints_to_corners(
    result_obj, best_idx: int, W: int, H: int
) -> list[dict] | None:
    """
    Extract the 4 plate corners from a YOLOv8-pose result.
    Returns list[{x,y}] × 4 ordered [tl, tr, br, bl] in normalised
    image coords, or None if keypoints aren't available / valid.

    Expects exactly 4 keypoints per detection — the model must have been
    trained with `kpt_shape: [4, 3]` and corners annotated as
    [tl, tr, br, bl]. The sum/diff ordering is reapplied defensively so
    we still get a sensible quad even if the training labels weren't
    perfectly consistent.
    """
    kpts = getattr(result_obj, "keypoints", None)
    if kpts is None or kpts.xy is None:
        return None
    xy = kpts.xy
    try:
        xy = xy.cpu().numpy()
    except Exception:
        xy = np.asarray(xy)
    if xy.ndim != 3 or xy.shape[0] <= best_idx or xy.shape[1] != 4 or xy.shape[2] != 2:
        return None
    pts = xy[best_idx].astype(float)

    # Reject degenerate (collinear / zero-area) keypoint sets
    area = float(abs(cv2.contourArea(pts.astype(np.float32))))
    if area < 4.0:
        return None

    ordered = _order_corners(pts)
    return [
        {"x": round(float(p[0]) / W, 4), "y": round(float(p[1]) / H, 4)}
        for p in ordered
    ]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def health():
    model_path = str(_MODEL_PATH) if _MODEL_PATH.exists() else "yolov8n.pt"
    task = "?"
    try:
        task = _model_task(get_model())
    except Exception:
        pass
    return {"status": "ok", "model": model_path, "task": task}


@app.post("/detect-plate")
async def detect_plate(file: UploadFile = File(...)):
    """
    Detect a license plate and return its 4 corners.

    Source priority (high → low):
      1. "keypoints"       — YOLOv8-pose direct corner regression. The
                             model must be a 4-keypoint pose model with
                             corners annotated as [tl, tr, br, bl]. Used
                             as-is for the final cache rendering.
      2. "bbox_stable"     — DEFAULT automatic source while no pose model
                             is deployed. Axis-aligned quad derived from
                             the YOLO bbox with a small inward pad. Always
                             succeeds. The frontend uses these corners
                             directly for `drawPerspective`.
      3. "opencv_fallback" — Only ever returned when `ALLOW_OPENCV_PROMOTION`
                             is True AND the strict quality gate passes.
                             Off by default — OpenCV refinement is too
                             unreliable on real-world plates.
      4. "tightened_bbox"  — never returned as the primary `corners` here;
                             still appears in `debug` for visibility.

    `debug` always contains the OpenCV refinement output (candidates,
    chosen method, sub-scores) so the frontend can show the experimental
    quad as an overlay even when it isn't promoted.
    """
    try:
        img_bytes = await file.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}")

    W, H  = img.size
    model = get_model()
    task  = _model_task(model)

    results = model(img, conf=0.25, verbose=False)
    if not results or len(results[0].boxes) == 0:
        logger.info("No plate detected")
        return {"found": False}

    result_obj = results[0]
    boxes      = result_obj.boxes
    best_idx   = int(boxes.conf.argmax())
    x1, y1, x2, y2 = boxes.xyxy[best_idx].tolist()
    conf = float(boxes.conf[best_idx])

    bbox = {
        "x1": round(x1 / W, 4),
        "y1": round(y1 / H, 4),
        "x2": round(x2 / W, 4),
        "y2": round(y2 / H, 4),
    }
    logger.info(
        f"YOLO bbox: ({bbox['x1']},{bbox['y1']})-({bbox['x2']},{bbox['y2']}) "
        f"conf={conf:.2f} task={task}"
    )

    # ---- Priority 1: pose-model keypoints --------------------------
    if task == "pose":
        kp_corners = _keypoints_to_corners(result_obj, best_idx, W, H)
        if kp_corners is not None:
            logger.info(f"Keypoints corners: {kp_corners}")
            return {
                "found":   True,
                "conf":    round(conf, 3),
                "bbox":    bbox,
                "corners": kp_corners,
                "source":  "keypoints",
            }
        logger.info(
            "Pose model loaded but keypoints unavailable — falling back to bbox_stable"
        )

    # ---- Priority 2: bbox_stable (default) -------------------------
    bbox_corners = _bbox_stable_corners(bbox, pad_frac=0.03)

    # OpenCV refinement still runs — but only for diagnostics. The
    # candidate landscape is exposed in `debug` so the frontend can show
    # the experimental quad as a faded overlay if desired.
    img_np                  = np.array(img)
    opencv_corners, refine_debug = refine_corners(img_np, bbox)

    # ---- Priority 3 (gated): OpenCV promotion ---------------------
    if ALLOW_OPENCV_PROMOTION:
        passed, reason = _opencv_passes_strict_gate(opencv_corners, refine_debug)
        if passed:
            method_tag = (refine_debug or {}).get("method", "?")
            logger.info(
                f"OpenCV promoted (gate=passed, method={method_tag}): {opencv_corners}"
            )
            return {
                "found":         True,
                "conf":          round(conf, 3),
                "bbox":          bbox,
                "corners":       opencv_corners,
                "source":        "opencv_fallback",
                "debug":         refine_debug,
                "gate_reason":   reason,
                "bbox_stable":   bbox_corners,  # for overlay comparison
            }
        logger.info(
            f"OpenCV refused by strict gate (reason={reason}) — using bbox_stable"
        )
    else:
        logger.info("ALLOW_OPENCV_PROMOTION=False — using bbox_stable as final source")

    return {
        "found":         True,
        "conf":          round(conf, 3),
        "bbox":          bbox,
        "corners":       bbox_corners,
        "source":        "bbox_stable",
        # Diagnostics: keep the OpenCV candidate landscape and the corners
        # it would have proposed. Useful as a debug overlay and to evaluate
        # whether the gate is calibrated correctly before flipping
        # ALLOW_OPENCV_PROMOTION on.
        "debug":         refine_debug,
        "opencv_corners": opencv_corners,
    }
