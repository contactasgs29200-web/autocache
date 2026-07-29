# Showroom interactif — scan guidé + tour 360°

Accès restreint : la fonctionnalité n'apparaît qu'après saisie du code
administrateur **`AURELE3D`** (menu *Code Administrateur*).

---

## 1. Ce que ça fait

L'utilisateur fait le tour du véhicule **et** balaie de haut en bas. L'app
découpe la surface à couvrir en une grille **azimut × hauteur** — 12 secteurs
de 30° × 3 bandes (bas de caisse, ligne médiane, toit et vitrage), soit
**36 zones** — et guide le remplissage case par case : « levez l'appareil »,
« continuez d'avancer », « revenez en arrière, une zone a été sautée ».

C'est le même schéma qu'un enrôlement d'empreinte digitale : couvrir une
surface, zone par zone, avec un retour visuel de progression.

Les vues obtenues **repartent dans le pipeline habituel** (cache plaque, fond,
colorimétrie). Les vues de la ligne médiane, remises en ordre de secteur,
forment ensuite un **tour 360°** que l'acheteur fait pivoter au doigt ; les
vues basses et hautes sont livrées comme photos normales, hors carrousel.

Ce n'est **pas** un modèle 3D : l'orbite reste figée sur le trajet de capture,
on ne déplace pas librement le véhicule dans une scène. C'est le compromis qui
permet un **coût marginal nul** — voir §5 et `BENCH_3D.md`.

---

## 2. Coût

**Zéro appel API.** Les contrôles qualité sont des calculs locaux sur le flux
vidéo (variance du laplacien, gradient, luminance) dans un canvas de 96×72 px,
5 fois par seconde. Aucune image ne quitte l'appareil pendant la capture.

Les 24 vues consomment ensuite le quota photos habituel, comme 24 photos
importées à la main — ni plus ni moins.

---

## 3. Architecture

```
src/showroomInteractif.js        logique pure, testable en Node (0 dépendance
                                 navigateur) : angles, suivi d'orbite, grille
                                 de couverture, consignes, analyse d'image,
                                 seuils qualité, indexation du visualiseur
src/components/ShowroomCapture.jsx   UI de scan (caméra, grille, guidage, revue)
src/components/Spin360.jsx           visualiseur rotatif (glisser / flèches)
tests/showroomInteractif.test.js     47 tests sur la logique pure
```

### Grille de couverture

`createCoverageMap()` tient une grille de 12 secteurs × 3 bandes. Chaque case
retient l'index de la prise qui l'a remplie, ce qui rend le bouton *Reprendre*
exact : annuler une prise libère sa case.

`guidanceFor()` produit la consigne. Elle privilégie un **changement de
hauteur** (geste immédiat, sans se déplacer) sur un changement de secteur —
d'où le poids 3 sur la distance azimutale : on finit les trois hauteurs d'un
secteur avant d'avancer. Le renvoi en arrière n'est déclenché que si la zone
manquante est réellement plus proche par l'arrière ; sur un cercle, un trou
« devant » se rattrape en continuant.

### Suivi de l'orbite

En tournant autour d'un véhicule pour le garder dans le cadre, le cap de
l'appareil décrit lui aussi un tour complet : le cumul des écarts de cap
approxime donc l'angle parcouru autour du sujet. `createOrbitTracker()`
intègre ce cumul en filtrant deux artefacts :

- **tremblement de main** (< 0,4° par échantillon) → ignoré, sinon la mesure
  dérive à l'arrêt ;
- **décrochage magnétique** (> 45° d'un coup) → resynchronisation sans
  compter la distance.

Le cumul est signé : sens horaire positif, antihoraire négatif. L'utilisateur
peut donc tourner dans le sens qu'il veut.

### Deux modes

| Mode | Condition | Comportement |
|---|---|---|
| **Auto** | Capteurs disponibles et autorisés | Secteur déduit de la boussole, hauteur du tangage (`beta`). Déclenchement automatique dès qu'on vise une zone vide avec une image correcte. |
| **Manuel** | Pas de capteurs, permission refusée, ou aucun événement en 1,5 s | L'utilisateur choisit la hauteur avec trois boutons et déclenche lui-même ; le secteur avance d'un cran à chaque prise. |

iOS exige `DeviceOrientationEvent.requestPermission()` depuis un geste
utilisateur : c'est le bouton **Démarrer le scan** qui la demande.

### Contrôles qualité

Un motif de rejet lisible est affiché en permanence — il doit dire quoi
corriger, pas seulement que c'est raté.

| Code | Motif | Seuil |
|---|---|---|
| `dark` / `bright` | Exposition | luminance moyenne hors [26, 234] |
| `blur` | Flou de bougé | variance du laplacien < 45 |
| `far` / `near` | Cadrage | fraction de pixels à fort gradient hors [0,16 – 0,94] |

L'exposition est diagnostiquée **avant** la netteté : une photo noire est
forcément aussi « floue », mais le motif utile pour l'utilisateur est
l'exposition.

Seuils calibrés pour un smartphone tenu à hauteur de hanche à ~3 m du
véhicule, volontairement permissifs : mieux vaut accepter une prise moyenne
que bloquer l'utilisateur en plein tour.

---

## 4. Points de conception

- **La capture remplace le lot.** Un tour 360° décrit *un* véhicule dans un
  ordre circulaire ; y ajouter des photos à la main casserait cet ordre.
  `handleCapturedViews` remplace donc le lot et lève `spin360Mode` ;
  `handlePhotoFiles` le baisse.
- **Le scan peut être clos incomplet.** Un mur ou un véhicule voisin empêche
  parfois de couvrir certaines zones. `isScanUsable()` exige seulement que la
  **ligne médiane soit complète** — c'est elle qui porte le tour 360° — et une
  couverture globale d'au moins deux tiers. Rester coincé sans pouvoir valider
  serait pire qu'un scan à 80 %.
- **Écran de revue avant le traitement.** Le scan ne déverse plus ses photos
  dans la page principale : un écran intermédiaire montre la couverture
  obtenue, les vignettes, et dit explicitement ce qui va se passer ensuite
  (masquage de la plaque, fond, colorimétrie). C'est là que se joue la
  différence entre « l'app m'a demandé des photos » et « l'app a scanné la
  voiture ».
- **Séparation carrousel / détails.** Seules les vues de la ligne médiane
  entrent dans le tour 360° (`ringCount` remonté au parent) : inclure les vues
  basses et hautes ferait sauter la rotation hors de l'orbite.
- **Nommage ordonné.** `frameFileName` produit `showroom360_01.jpg` … pour le
  carrousel et `showroom_detail_01.jpg` … pour le reste : l'ordre du tour
  survit au tri alphabétique, donc à l'export et à l'envoi par mail.

---

## 5. Ce que ça ne fait pas (et pourquoi)

Le vrai scan 3D (photogrammétrie / Gaussian Splatting) permettrait de déplacer
librement le véhicule dans un showroom virtuel. Il a été écarté en première
étape pour quatre raisons :

1. **La carrosserie est un cas pathologique** pour la reconstruction
   multi-vues (vernis spéculaire, chrome, vitrages).
2. **Le scan embarque l'éclairage du lieu de capture** — reflets du parking
   compris. Le ré-éclairage d'un splat est un problème de recherche ouvert.
3. **Une PWA n'a pas accès au tracking AR** (ARKit/ARCore) : la position est
   déduite des capteurs d'orientation, ce qui suffit à guider une couverture
   mais pas à reconstruire une pose caméra précise.
4. **Le coût casse le modèle** : ~0,30 à 1,50 € de GPU par scan, contre ~1 ct
   par photo aujourd'hui. Un scan ≈ un mois de consommation d'un abonné.
5. **Ce ne serait jamais instantané** : capture, envoi de 100 à 200 photos,
   puis plusieurs minutes de calcul. Rien à voir avec le retour immédiat d'un
   enrôlement d'empreinte, qui se calcule sur le capteur.

La couche de scan guidé construite ici est **exactement celle qu'exigerait un
vrai scan 3D** — seule la densité de vues changerait. Le protocole pour
trancher est dans **`BENCH_3D.md`** : deux véhicules, ~150 photos, un service
de calcul hébergé, décision sur pièces avant tout développement.

---

## 6. Pistes suivantes

- Export du tour en fichier autonome (HTML embarquable) pour le site de la
  concession.
- Densité de la grille réglable (aujourd'hui figée à 12 secteurs × 3 bandes).
- Repérage automatique du véhicule dans le cadre pour affiner le contrôle de
  cadrage — le modèle ONNX local (`plate-keypoints.onnx`) donne déjà un
  indice de présence gratuit et inexploité ici.
