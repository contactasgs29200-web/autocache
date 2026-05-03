# Pipeline plaque : de la photo brute au modèle déployé

Vue d'ensemble du chemin complet pour passer de **OpenCV-fallback**
à un vrai modèle keypoints en production.

```
[1] Photos SaaS  →  [2] Export dataset  →  [3] Annotation Roboflow
                                                      ↓
[6] Railway live ←  [5] Upload best.pt  ←  [4] Entraînement local
```

---

## 1. Collecte (dans le SaaS)

Chaque session de traitement de photos accumule des originaux où la
plaque a été détectée par YOLO. C'est la matière première du dataset.

Cible : viser au moins **200 photos** avant d'entraîner un premier
modèle. Diversifier autant que possible : angles (face / 3⁄4 / côté),
distances, lumière, météo, états (propre / sale), pays.

---

## 2. Export

Après un batch traité, sur l'écran **Résultats** :

> **Export dataset (N)** → bouton à gauche de *Tout télécharger*

Télécharge un par un les fichiers originaux (uniquement ceux où une
plaque a été détectée), nommés :

```
plate_2026-05-03T15-04_0001_originalname.jpg
plate_2026-05-03T15-04_0002_originalname.jpg
...
```

Les déposer ensuite dans `backend/dataset/raw/`.

---

## 3. Annotation (Roboflow)

Voir **`backend/dataset/ROBOFLOW.md`** — guide pas à pas.

Résumé :

- Type projet : **Keypoint Detection**
- Classe : `plate`
- Skeleton : 4 keypoints `tl`, `tr`, `br`, `bl` (ordre strict)
- Pour chaque image : bbox + 4 clics dans l'ordre tl → tr → br → bl
- Augmentations : Horizontal Flip ✅ (Roboflow gère le `flip_idx`),
  Brightness ±15%, Exposure ±10%
- Export : **YOLOv8 Keypoints** (zip)

---

## 4. Entraînement (local ou GPU cloud)

```bash
cd backend

# Une seule fois
pip install -r requirements.txt

# Brancher le dataset Roboflow exporté
unzip ~/Downloads/plate-keypoints-1.zip -d /tmp/rf-export
rsync -av /tmp/rf-export/train/  dataset/train/
rsync -av /tmp/rf-export/valid/  dataset/valid/

# Lancer l'entraînement
python train_keypoints.py --epochs 100 --base-model yolov8n-pose.pt
```

Sur CPU c'est lent (~plusieurs heures pour 100 epochs sur 500 images).
Sur GPU local (RTX 3060+) ou cloud (Lambda / Vast / Colab) : 30 min à
1 h.

Variantes du modèle de base :

| Base model         | Vitesse | Précision | Quand l'utiliser |
|--------------------|---------|-----------|------------------|
| `yolov8n-pose.pt`  | ★★★★★   | ★★        | POC, ressources limitées |
| `yolov8s-pose.pt`  | ★★★★    | ★★★       | Compromis recommandé |
| `yolov8m-pose.pt`  | ★★★     | ★★★★      | Production, GPU dispo |
| `yolov8l-pose.pt`  | ★★      | ★★★★★     | Précision max |

À la fin :

```
runs/pose/plate-keypoints/weights/best.pt
runs/pose/plate-keypoints/weights/last.pt
runs/pose/plate-keypoints/results.png   ← courbes loss / mAP
```

Vérifier que `metrics/mAP50` se stabilise (~> 0.7 pour qu'on puisse
parler d'un modèle utile sur des plaques typiques).

---

## 5. Test rapide (optionnel)

```bash
cd backend
python -c "
from ultralytics import YOLO
m = YOLO('runs/pose/plate-keypoints/weights/best.pt')
print('task:', m.task)        # doit afficher 'pose'
res = m('dataset/valid/images/some-image.jpg', conf=0.25)
print(res[0].keypoints.xy)    # doit afficher 1 plaque × 4 points
"
```

Si `m.task == 'pose'` et que les 4 points apparaissent, le modèle est
prêt à remplacer le détecteur courant.

---

## 6. Déploiement Railway

Deux options.

### Option A — `MODEL_URL` (recommandé, pas de rebuild image)

1. Héberger `best.pt` à une URL HTTP accessible :
   - GitHub Release (drag-and-drop dans une release du repo) ←
     simple, public
   - S3 / Cloudflare R2 / Backblaze B2 (privé)
2. Sur Railway → service backend → Variables → mettre à jour :

   ```
   MODEL_URL = https://github.com/<user>/autocache/releases/download/v0.X/best.pt
   ```

3. Déclencher un redéploiement (push vide ou bouton **Redeploy**).
   Le `Dockerfile` (build arg `MODEL_URL`) télécharge le poids au
   build → le container démarre instantanément.
4. Vérifier `/` du backend :

   ```bash
   curl https://<railway-domain>/
   # {"status":"ok","model":"/app/models/best.pt","task":"pose"}  ← task: pose !
   ```

5. Tester `/detect-plate` :

   ```bash
   curl -F "file=@une-photo.jpg" https://<railway-domain>/detect-plate
   # {"found":true,"conf":0.92,"bbox":{...},"corners":[...],"source":"keypoints"}
   ```

   Le champ `source` doit valoir `"keypoints"` — confirmation que la
   nouvelle branche est active.

### Option B — Bake dans l'image Docker

Si on ne veut pas dépendre d'un téléchargement :

```dockerfile
# backend/Dockerfile, après le COPY main.py
COPY best.pt /app/models/best.pt
```

Et placer `best.pt` à la racine du repo backend (⚠️ `.gitignore` selon
la taille — un poids YOLOv8n-pose fait ~6 MB, pas un problème ; un
YOLOv8m-pose fait ~50 MB, à externaliser).

---

## 7. Validation côté frontend

Une fois `source: "keypoints"` retourné par l'API, le frontend
affiche :

- Polygone orange **collant aux 4 vrais coins** (régression directe)
- Label méthode **vert** `keypoints` au-dessus du badge confiance

Plus de chemin OpenCV en routine — il ne sert plus que de filet de
sécurité si le modèle pose ne convergerait pas (rare une fois bien
entraîné).

---

## 8. Itérations

Quand on observe des cas où `keypoints` se trompe :

1. Réutiliser le bouton **Export dataset** sur ces photos.
2. Annoter dans Roboflow (la plateforme garde l'historique du projet).
3. Régénérer une version → exporter → ré-entraîner sur le dataset
   élargi (`--resume` pour continuer depuis le `last.pt`, ou repartir
   de zéro).
4. Re-uploader le nouveau `best.pt`, mettre à jour `MODEL_URL`,
   redeploy.
