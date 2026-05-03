# License-Plate 4-Corner Keypoint Dataset

Layout :

```
backend/dataset/
├── data.yaml             # YOLOv8-pose config (kpt_shape, flip_idx, names)
├── README.md             # this file
├── ROBOFLOW.md           # step-by-step annotation guide
├── raw/                  # ← drop the SaaS "Export dataset" downloads here
├── train/
│   ├── images/           # *.jpg / *.png
│   └── labels/           # *.txt (one per image, same basename)
└── valid/
    ├── images/
    └── labels/
```

The `train/` and `valid/` layout matches a fresh Roboflow YOLOv8
Keypoints export, so an exported zip drops in straight.

---

## Workflow rapide

1. Dans le SaaS, traiter un lot de photos. Cliquer **"Export dataset"**
   (résultats → bouton à gauche de "Tout télécharger"). Les originaux
   où une plaque a été détectée sont téléchargés sous le préfixe
   `plate_<timestamp>_NNNN_<nom>.jpg`.
2. Déposer ces fichiers dans `backend/dataset/raw/`.
3. Suivre **`ROBOFLOW.md`** pour l'annotation puis l'export YOLOv8
   Keypoints.
4. Unzipper l'export dans `backend/dataset/` (les dossiers `train/` et
   `valid/` sont écrasés).
5. Lancer `python backend/train_keypoints.py`.
6. Suivre `PIPELINE.md` (racine du repo) pour déployer le `best.pt`
   obtenu sur Railway.

---

## Format des labels

Une détection par ligne :

```
<class_idx> <bbox_cx> <bbox_cy> <bbox_w> <bbox_h>  <x1> <y1> <v1>  <x2> <y2> <v2>  <x3> <y3> <v3>  <x4> <y4> <v4>
```

- `class_idx` = `0` (classe unique : `plate`).
- Toutes les coordonnées sont **normalisées dans [0, 1]** (divisées par
  width / height de l'image).
- `v` = visibilité : `0` pas dans l'image · `1` occlus mais labellé ·
  `2` visible.

### Ordre des keypoints — **OBLIGATOIRE**

```
0. top-left
1. top-right
2. bottom-right
3. bottom-left
```

Cohérent avec `flip_idx: [1, 0, 3, 2]` dans `data.yaml` (utilisé pour
augmenter via flip horizontal pendant l'entraînement).

Exemple, plaque centre-bas d'une photo 1920×1080 :

```
0  0.500 0.722 0.156 0.046   0.422 0.699 2   0.578 0.701 2   0.580 0.745 2   0.421 0.743 2
```

---

## Volumes recommandés

| Phase                      | Train images | Val images |
|----------------------------|--------------|------------|
| POC                        | ~200         | ~50        |
| Production utilisable      | ~500–1000    | ~100       |
| Robuste multi-pays         | 2000+        | 400+       |
