# Roboflow — guide d'annotation pas à pas

Annoter les 4 coins d'une plaque dans Roboflow et exporter au format
qui s'unzippe directement dans `backend/dataset/`.

---

## 1. Créer le projet

1. Aller sur https://roboflow.com → **New Project**
2. Renseigner :
   - **Project Name** : `autocache-plate-keypoints` (ou autre)
   - **License** : *Private* (laisser par défaut sur le plan gratuit)
   - **Project Type** : **Keypoint Detection** ⚠️ pas Object Detection
   - **What are you detecting?** : `plate`

> **Critique** : il faut choisir *Keypoint Detection*. Le type *Object
> Detection* ne permet pas d'annoter les 4 coins.

---

## 2. Définir le squelette (skeleton)

Avant la première annotation, Roboflow demande de définir les keypoints.

1. **Class name** : `plate` (un seul, en minuscules)
2. **Skeleton** : ajouter exactement **4 keypoints** dans cet ordre :

   | Index | Nom (Roboflow) | Position sur la plaque |
   |-------|----------------|------------------------|
   | 0     | `tl`           | top-left (haut-gauche) |
   | 1     | `tr`           | top-right (haut-droite) |
   | 2     | `br`           | bottom-right (bas-droite) |
   | 3     | `bl`           | bottom-left (bas-gauche) |

3. **Connexions** (optionnel, juste visuel) :
   - tl → tr
   - tr → br
   - br → bl
   - bl → tl

> **L'ordre est strict.** Le code (`backend/main.py` et
> `data.yaml flip_idx`) suppose `[tl, tr, br, bl]`. Si tu inverses des
> indices, le modèle entraîné renverra des coins permutés et
> `drawPerspective` produira un quad tordu.

---

## 3. Importer les images

1. Aller dans **Upload** dans le projet
2. Drag-and-drop les fichiers obtenus via le bouton **"Export dataset"**
   du SaaS (préfixés `plate_<timestamp>_NNNN_<nom>.jpg`)
3. Roboflow propose un split train/val/test → garder la valeur par
   défaut **70/20/10** (ou 80/20 si pas de test). Notre `data.yaml`
   utilise `train/` et `valid/`.
4. Cliquer **Save and Continue**

---

## 4. Annoter

Pour chaque image :

1. Tracer la **bbox** autour de la plaque (le plus serré possible).
2. **Cliquer chaque coin dans l'ordre** : tl → tr → br → bl.
   Roboflow place les 4 keypoints sur le squelette.
3. Si un coin n'est pas visible (caché par un câble, par ex.) :
   - le placer là où on l'estime (intersection des bords visibles)
   - cocher **"Occluded"** → exporte avec visibilité `1` au lieu de `2`
4. Si on annote plusieurs plaques sur une même image, répéter
   bbox + 4 keypoints pour chacune.
5. **Save** (raccourci : `S`).

> Astuce : utiliser **Tab** pour passer d'une image à l'autre, et
> **Shift+Tab** pour revenir en arrière.

### Volume cible

| Phase                  | Train | Valid |
|------------------------|-------|-------|
| Premier test           | ~200  | ~50   |
| Modèle utilisable prod | ~500  | ~100  |
| Robuste multi-pays     | 2000+ | 400+  |

Diversité : angles (face / 3⁄4 / côté), distances, lumière (jour /
nuit / contre-jour), états (propre / sale / pluie), pays (FR + EU).

---

## 5. Générer la version (Generate)

1. Aller dans **Versions** → **Create New Version**
2. **Preprocessing** :
   - **Auto-Orient** : ✅
   - **Resize** : *Stretch to* `640×640` (ou `Fit within` selon goût ;
     stretch est plus simple)
3. **Augmentations** (optionnel mais conseillé) :
   - **Horizontal Flip** : ✅ — Roboflow permute automatiquement
     les keypoints grâce au `flip_idx` qu'il connaît.
   - **Brightness** : ±15%
   - **Exposure** : ±10%
   - **Blur** : 0–1 px
   - ⚠️ **Pas de Vertical Flip** (la plaque a un haut/bas fixe).
4. **Generate** (gratuit jusqu'à 3 augmentations par image).

---

## 6. Exporter au format YOLOv8 Keypoints

1. Sur la version générée → **Download Dataset**
2. **Format** : sélectionner **YOLOv8** → puis **Keypoints**
   (parfois affiché comme *YOLOv8 Pose* selon la version Roboflow)
3. **Download zip to computer** → unzipper.

L'archive contient :

```
plate-keypoints-1/
├── data.yaml          ← inclut chemins, kpt_shape, flip_idx, names
├── train/
│   ├── images/        *.jpg
│   └── labels/        *.txt (1 par image)
├── valid/
│   ├── images/
│   └── labels/
└── README.dataset.txt
```

---

## 7. Brancher dans le repo

```bash
# Depuis le repo autocache
cd backend/dataset

# Option A — remplacer le data.yaml par celui de Roboflow
cp /chemin/vers/plate-keypoints-1/data.yaml data.yaml

# Option B — laisser notre data.yaml et copier juste les images/labels
rsync -av /chemin/vers/plate-keypoints-1/train/  train/
rsync -av /chemin/vers/plate-keypoints-1/valid/  valid/
```

> Notre `data.yaml` est déjà aligné sur la structure Roboflow (`train/
> images`, `valid/images`, `kpt_shape: [4, 3]`, `flip_idx: [1, 0, 3, 2]`,
> `names: { 0: plate }`). Option B suffit dans 95% des cas.

---

## 8. Entraîner

```bash
cd backend
pip install -r requirements.txt
python train_keypoints.py --epochs 100
```

Voir `PIPELINE.md` à la racine du dépôt pour la suite (déploiement
sur Railway).
