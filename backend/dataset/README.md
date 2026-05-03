# License-Plate 4-Corner Keypoint Dataset

Used to train a **YOLOv8-pose** model that predicts the 4 plate corners
directly. Once trained, the resulting `best.pt` replaces the current
detection model and `main.py` automatically routes through the keypoints
branch (returning `source: "keypoints"`).

## Folder layout

```
backend/dataset/
├── data.yaml          # ← Ultralytics config (do not edit unless you know why)
├── README.md
├── images/
│   ├── train/         # *.jpg / *.png
│   └── val/
└── labels/
    ├── train/         # *.txt — one per image, same basename
    └── val/
```

## Label format

One detection per line:

```
<class_idx> <bbox_cx> <bbox_cy> <bbox_w> <bbox_h>  <x1> <y1> <v1>  <x2> <y2> <v2>  <x3> <y3> <v3>  <x4> <y4> <v4>
```

- `class_idx` = `0` (we only have one class: `plate`)
- All x/y values are **normalised to [0, 1]** by image width/height.
- `v` is visibility:
  - `0` = not in image
  - `1` = labeled but occluded / hidden
  - `2` = visible

### Keypoint order — **MANDATORY**

```
1. top-left      (kp index 0)
2. top-right     (kp index 1)
3. bottom-right  (kp index 2)
4. bottom-left   (kp index 3)
```

This must match `flip_idx: [1, 0, 3, 2]` in `data.yaml` (used during
training-time horizontal flip augmentation).

### Example label line

For a plate roughly in the centre-bottom of a 1920×1080 image:

```
0  0.500 0.722 0.156 0.046   0.422 0.699 2   0.578 0.701 2   0.580 0.745 2   0.421 0.743 2
```

## Annotation tools

Pick the one you prefer — all can export YOLOv8 keypoint labels:

### Roboflow (recommended for small datasets)

1. Create a *Keypoint Detection* project.
2. Define class `plate` with skeleton: `tl`, `tr`, `br`, `bl`
   (in that exact order).
3. Annotate. Export → format **YOLOv8 Keypoints**.
4. Drop the resulting `images/` and `labels/` folders into
   `backend/dataset/`.

### CVAT

1. Create a project, add class `plate`, define a **skeleton** with
   4 named points: `tl`, `tr`, `br`, `bl`.
2. Annotate.
3. Export → **Ultralytics YOLO 1.1**.

### Labelme + converter

Manual labelme JSON → YOLOv8-pose conversion is more involved.
Roboflow / CVAT are faster.

## Dataset targets

| Phase                      | Train images | Val images |
|----------------------------|--------------|------------|
| Proof-of-concept           | ~200         | ~50        |
| Usable in production       | ~500–1000    | ~100       |
| Robust across countries    | 2000+        | 400+       |

Aim for diversity:

- angles: head-on, 3/4 left, 3/4 right, side, low / high camera
- distances: ~5 m close-up to ~30 m wide shots
- lighting: bright sun, overcast, dusk, night with flash
- conditions: clean, muddy, partially occluded, glare on plate
- countries: at minimum FR + a few EU variants

## Train

```bash
cd backend
pip install -r requirements.txt
python train_keypoints.py --epochs 100 --base-model yolov8n-pose.pt
```

Best weights end up under `runs/pose/<name>/weights/best.pt`.

## Deploy

Two options:

1. **Static URL** (Railway): upload `best.pt` somewhere addressable by
   HTTP, then set `MODEL_URL=https://...`. The Dockerfile downloads it
   at build time; `main.py` autodetects the pose task and uses
   keypoints.
2. **Bake into the image**: copy `best.pt` into the build context and
   adjust the Dockerfile to `COPY best.pt /app/models/best.pt`.

Either way, no code change is needed — `_model_task()` in `main.py`
detects pose vs detect models on load and switches branches.
