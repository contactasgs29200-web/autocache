# Modèle « 4 coins de plaque » — par où commencer

Objectif : un modèle qui pose le cache-plaque parfaitement en perspective,
à tous les angles (y compris 3/4), **sans coût par photo** — il tournera
dans le navigateur du client, comme le détourage @imgly.

Le pipeline complet : **collecter → annoter → entraîner → intégrer**.
Les deux premières étapes sont manuelles (vous) ; les deux dernières sont
automatisées / à ma charge.

---

## Étape 1 — Collecter ~250-300 photos (vous)

En tant que concession, vous avez déjà la matière. Rassemblez dans un
dossier des photos de véhicules **avec plaque visible**, en variant au
maximum :

- **Angles** : face, **3/4 avant/arrière** (le cas qui coince
  aujourd'hui — surreprésentez-le), côté.
- **Lumière** : jour, intérieur, contre-jour, ombre.
- **État** : plaque propre / sale / reflets.
- **Format** : française standard, éventuellement quelques UE.

Cible pour un premier modèle utilisable : **~200 en entraînement + ~50 en
validation**. Plus tard, ré-entraîner sur 500+ le rendra excellent.

> Pas besoin de trier : Roboflow fait le split train/validation.

---

## Étape 2 — Annoter les 4 coins dans Roboflow (vous, ~½ journée)

Suivez **`ROBOFLOW.md`** (dans ce dossier) — guide pas à pas. En résumé :

- Projet **Keypoint Detection** (pas Object Detection).
- Squelette : 4 keypoints **dans l'ordre strict tl → tr → br → bl**.
- Pour chaque photo : une bbox autour de la plaque + 4 clics aux coins.
- Augmentations conseillées : Horizontal Flip, Brightness ±15%.
- Export : **YOLOv8 → Keypoints** (zip).

C'est l'étape qui demande de la patience (cliquer 4 coins × ~250 photos),
mais c'est simple et sans compétence technique. C'est aussi ce qui
détermine la qualité finale : des coins bien placés = un cache qui colle.

---

## Étape 3 — Entraîner + exporter en ONNX (automatisé, ~30 min)

Ouvrez **`train_and_export_colab.ipynb`** dans Google Colab
(https://colab.research.google.com → Importer le notebook). Activez le GPU
gratuit (T4), puis exécutez les cellules de haut en bas. Le notebook :

1. installe tout,
2. charge votre export Roboflow,
3. entraîne le modèle,
4. l'exporte en **`plate-keypoints.onnx`** et vous le fait télécharger.

Aucun terminal, aucune ligne de commande. Colab prête le GPU gratuitement.

> Alternative locale (si vous avez un GPU) : `cd backend && pip install -r
> requirements.txt && python train_keypoints.py`, puis exporter en ONNX
> — mais le notebook Colab est plus simple.

---

## Étape 4 — Intégration dans AutoCache (à ma charge, 1-2 jours)

Transmettez-moi le fichier `plate-keypoints.onnx`. Je :

1. l'embarque dans l'app et le fais exécuter via onnxruntime-web (déjà
   chargé pour le détourage) — inférence ~200 ms/photo, 100 % navigateur ;
2. le branche comme **source principale** des 4 coins ; Plate Recognizer
   puis Claude deviennent les secours ;
3. teste le décodage de la sortie (coins → repère image) sur vos photos.

Le reste du pipeline ne change pas : `drawPlateOverlay` pose déjà le cache
en perspective sur 4 coins. On ne remplace que la **source** des coins.

---

## Étape 5 — Itérer

Quand vous repérez un cas raté : ajoutez ces photos au dataset Roboflow,
régénérez une version, ré-entraînez (Colab), envoyez-moi le nouvel ONNX.
Le modèle s'améliore en continu sur vos conditions réelles — c'est là tout
l'intérêt du modèle maison face à une API.

---

### Récapitulatif du partage des tâches

| Étape | Qui | Effort |
|---|---|---|
| 1. Collecter ~250 photos | Vous | Vous les avez déjà |
| 2. Annoter (Roboflow) | Vous | ~½ journée |
| 3. Entraîner + ONNX (Colab) | Vous (clics) | ~30 min |
| 4. Intégration navigateur | Moi | 1-2 jours |
| 5. Itérations | Vous + moi | continu |
