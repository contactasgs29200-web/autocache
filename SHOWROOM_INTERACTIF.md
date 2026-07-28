# Showroom interactif — capture guidée + tour 360°

Accès restreint : la fonctionnalité n'apparaît qu'après saisie du code
administrateur **`AURELE3D`** (menu *Code Administrateur*).

---

## 1. Ce que ça fait

L'utilisateur fait le tour du véhicule avec son téléphone. L'app le guide
(anneau de progression), contrôle chaque prise et déclenche automatiquement
aux bons angles. Les vues obtenues **repartent dans le pipeline habituel**
(cache plaque, fond, colorimétrie), puis leur ordre circulaire permet
d'afficher un **tour 360°** que l'acheteur fait pivoter au doigt.

Ce n'est **pas** de la 3D : l'orbite est figée sur le trajet de capture, on ne
déplace pas librement le véhicule dans une scène. C'est le compromis qui
permet un **coût marginal nul** — voir §5.

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
                                 navigateur) : angles, suivi d'orbite,
                                 analyse d'image, seuils qualité, indexation
                                 du visualiseur
src/components/ShowroomCapture.jsx   UI de capture (caméra, anneau, auto-shutter)
src/components/Spin360.jsx           visualiseur rotatif (glisser / flèches)
tests/showroomInteractif.test.js     30 tests sur la logique pure
```

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
| **Auto** | Boussole disponible et autorisée | Déclenchement automatique à chaque angle cible, si la qualité passe |
| **Manuel** | Pas de boussole, permission refusée, ou aucun événement en 1,5 s | L'utilisateur déclenche lui-même, guidé par le compteur de vues |

iOS exige `DeviceOrientationEvent.requestPermission()` depuis un geste
utilisateur : c'est le bouton **Démarrer le tour** qui la demande.

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
- **Le tour peut être clos avant 360°.** Un mur ou un véhicule voisin empêche
  parfois de boucler : dès 8 vues, le bouton *Terminer* apparaît. Rester
  coincé sans pouvoir valider serait pire qu'un tour de 20 vues.
- **Nommage ordonné.** `frameFileName` produit `showroom360_01.jpg` …
  `showroom360_24.jpg` : l'ordre du tour survit au tri alphabétique, donc à
  l'export et à l'envoi par mail.

---

## 5. Ce que ça ne fait pas (et pourquoi)

Le vrai scan 3D (photogrammétrie / Gaussian Splatting) permettrait de déplacer
librement le véhicule dans un showroom virtuel. Il a été écarté en première
étape pour quatre raisons :

1. **La carrosserie est un cas pathologique** pour la reconstruction
   multi-vues (vernis spéculaire, chrome, vitrages).
2. **Le scan embarque l'éclairage du lieu de capture** — reflets du parking
   compris. Le ré-éclairage d'un splat est un problème de recherche ouvert.
3. **Une PWA n'a pas accès au tracking AR** (ARKit/ARCore), donc pas de
   guidage de capture fiable sans app native.
4. **Le coût casse le modèle** : ~0,30 à 1,50 € de GPU par scan, contre ~1 ct
   par photo aujourd'hui. Un scan ≈ un mois de consommation d'un abonné.

La couche de capture guidée construite ici est **exactement celle qu'exigerait
un vrai scan 3D** : si le bench GPU est un jour concluant, elle est réutilisée
telle quelle et seul le traitement aval change.

---

## 6. Pistes suivantes

- Export du tour en fichier autonome (HTML embarquable) pour le site de la
  concession.
- Réglage du nombre de vues (8 à 48) exposé dans l'UI ; aujourd'hui figé à 24.
- Détection de trou d'angle : signaler les secteurs sous-échantillonnés en fin
  de tour plutôt que de les découvrir à la lecture.
