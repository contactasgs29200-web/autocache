"""
Train a YOLOv8-pose model that predicts the 4 corners of a license plate.

Usage:
    cd backend
    pip install -r requirements.txt
    python train_keypoints.py --epochs 100

After training:
    1. Copy `runs/pose/<name>/weights/best.pt` somewhere reachable by Railway
       (e.g. release asset, S3, public URL).
    2. Set the `MODEL_URL` env var (or rebuild the image with that URL as a
       Docker build arg) so `main.py` loads the new pose model. The detection
       branch in `/detect-plate` will automatically switch to the keypoints
       path — no code change needed.

See `dataset/README.md` for the annotation procedure and label format.
"""
from __future__ import annotations

import argparse
from pathlib import Path

# Lazy import so the module is still importable in environments without
# ultralytics installed (e.g. linting / static checks on the API server).
def _train(args):
    from ultralytics import YOLO

    model = YOLO(args.base_model)
    model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        name=args.name,
        patience=args.patience,
        device=args.device,
        # Pose-specific defaults are already tuned in ultralytics; override
        # via additional kwargs here if you need them.
    )

    weights = Path("runs") / "pose" / args.name / "weights" / "best.pt"
    print(f"\n✓ Training complete. Best weights → {weights}")
    print("  Upload this file and point MODEL_URL at it on Railway, or bake")
    print("  it into the Docker image. main.py auto-detects pose models.")


def parse_args():
    here = Path(__file__).resolve().parent
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--data",
        default=here / "dataset" / "data.yaml",
        type=Path,
        help="Path to data.yaml",
    )
    p.add_argument(
        "--base-model",
        default="yolov8n-pose.pt",
        help="Pretrained pose checkpoint (n/s/m/l/x). 'n' is fastest, 'x' biggest.",
    )
    p.add_argument("--epochs",   type=int, default=100)
    p.add_argument("--imgsz",    type=int, default=640)
    p.add_argument("--batch",    type=int, default=16)
    p.add_argument("--patience", type=int, default=30,
                   help="Early-stopping patience (epochs without improvement).")
    p.add_argument("--name",     default="plate-keypoints",
                   help="Run name → runs/pose/<name>/")
    p.add_argument("--device",   default="",
                   help="'' (auto), 'cpu', '0', '0,1', 'mps' …")
    return p.parse_args()


def main():
    args = parse_args()
    if not args.data.exists():
        raise SystemExit(
            f"data.yaml not found at {args.data}. "
            f"See backend/dataset/README.md for setup."
        )
    _train(args)


if __name__ == "__main__":
    main()
