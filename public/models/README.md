# Modèles ONNX (navigateur)

Déposer ici `plate-keypoints.onnx` (export YOLOv8-pose depuis Colab, renommé).
Le fichier est chargé par src/plateKeypoints.js à l'URL /models/plate-keypoints.onnx.
C'est le **seul** détecteur de plaque de l'application : en son absence, aucune
détection n'a lieu et les caches se posent à la main depuis l'écran Résultats
(un bandeau le signale à la fin du lot). Il n'y a plus de repli automatique.
