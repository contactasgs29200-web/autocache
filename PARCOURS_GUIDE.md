# Parcours photo guidé — le cache plaque dans le viseur

Disponible pour tous, sans code d'accès. Le bouton apparaît dans **02 — Photos
de véhicules** dès que la page a accès à une caméra (`getUserMedia`, donc HTTPS
ou localhost). Il occupe la place de l'ancien *Showroom interactif*, retiré du
produit — voir §6.

---

## 1. Ce que ça fait

L'utilisateur photographie le véhicule **depuis l'app**, en quatre prises
imposées, dans l'ordre de marche autour de la voiture :

1. 3/4 avant gauche
2. Face avant
3. 3/4 avant droit
4. Arrière

Puis autant de **photos bonus** qu'il veut (intérieur, jantes, détails…).

La différence avec un simple appareil photo : sur les quatre vues imposées, le
**cache plaque est déjà dessiné au milieu du viseur**. L'utilisateur ne cadre
pas une voiture puis n'espère pas que la détection trouve la plaque — il cadre
sa voiture *pour que la plaque tombe dans le cache*. Le cache affiché est le
sien (son logo), pas un rectangle abstrait : ce qu'il voit pendant la visée est
ce qui sera posé.

À la sortie, les photos rejoignent le lot courant. Le cache est posé **là où
il a été visé**, sans aucune détection ; le reste du pipeline (fond,
colorimétrie) s'applique normalement. Tout reste ajustable ensuite — déplacer
le cache, en ajouter un deuxième, rogner, changer le fond.

---

## 2. Coût : zéro

**Aucun appel facturé, ni pendant ni après la prise de vue.** C'est le second
intérêt de l'option, à égalité avec le confort de cadrage.

Le contrôle d'exposition et de netteté est un calcul local sur le flux vidéo
(96 × 72 px, 4 fois par seconde), et il est **indicatif** : il conseille, il ne
bloque jamais le déclencheur. C'est l'utilisateur qui décide si sa photo à
contre-jour lui convient.

Surtout, les quatre vues du parcours ne repassent par **aucun détecteur** —
pas même le modèle local, seul détecteur de l'application. Demander à quelqu'un
d'aligner sa plaque au pixel près pour aller ensuite la chercher avec un
détecteur — qui la déplacerait, et serait facturé — n'aurait aucun sens.
`plateFromGuidedQuad` transforme la visée en résultat de détection, et le
pipeline le consomme comme s'il venait d'un détecteur.

Restent payants, comme partout ailleurs : les **photos bonus** (cadrage libre,
donc détection normale) et le **mode Showroom** s'il est activé (détourage et
détection de véhicule). Les photos consomment le quota habituel.

---

## 3. Architecture

```
src/guidedTour.js                logique pure, testable en Node : plan de prise
                                 de vue, gabarit du cache, recadrage « cover »,
                                 avancement, nommage
src/components/GuidedTour.jsx    UI de prise de vue (caméra, gabarit, revue)
tests/guidedTour.test.js         25 tests sur la logique pure
```

Points d'accroche dans `App.jsx` :

| Élément | Rôle |
|---|---|
| `handleGuidedPhotos` | ajoute les photos au lot, avec leur `plateQuad` |
| `plateFromGuidedQuad` | transforme une visée en résultat de détection |
| `startPlateJob` | court-circuite la détection quand la photo a un `plateQuad` |
| `guidedIntroSeen` / `rememberGuidedIntro` | mémorisent « ne plus afficher » l'avertissement caméra |

### Le gabarit du cache — mesuré, pas calculé

`plateQuadForStep(stepId, aspect)` rend un quadrilatère normalisé (0–1) sur la
zone visible du viseur.

La première version calculait ce gabarit : rapport 520/110 d'une plaque
française, largeur réduite par l'encombrement apparent du véhicule. C'était
plausible et faux. Un cache réellement posé par l'app est **plus plat** qu'une
plaque nue (l'appareil est au-dessus du niveau de la plaque, qui se comprime),
et surtout il est **franchement incliné** sur les vues 3/4 — or c'est cette
inclinaison qui dit à l'utilisateur qu'il est bien placé, bien plus que la
taille.

Les valeurs viennent donc de **quatre photos de référence déjà traitées par
l'app**, relevées par segmentation du cache puis rectangle d'aire minimale :

| Vue | Largeur (% largeur photo) | L/H | Inclinaison | Véhicule (% largeur) |
|---|---|---|---|---|
| 3/4 avant gauche | 12,30 % | 3,56 | **+14,1°** | 72 % |
| Face avant | 23,04 % | 5,49 | 0° | 59 % |
| 3/4 avant droit | 12,43 % | 3,39 | **−18,2°** | 79 % |
| Arrière | 22,72 % | 5,06 | −1,2° | 66 % |

Deux relevés sont arrondis volontairement : l'arrière passe à 0° (−1,2° est un
tremblement de main, pas une propriété de la vue), et l'écart d'épaisseur entre
bord proche et bord lointain — mesuré entre +5 % et +11 % selon la photo — est
fixé à +8 %, le bord proche étant déduit de la géométrie. La mesure était dans
le bruit, et une asymétrie entre les deux vues 3/4 se verrait à l'écran.

Trois conséquences dans le code :

- **`ratio` désigne la boîte englobante**, pas une hauteur moyenne : c'est ainsi
  qu'il a été mesuré. Le définir autrement sortait les vues 3/4 4 % trop plates.
- **Le quadrilatère est construit et tourné dans une unité commune** — la largeur
  du viseur — puis converti en y à la toute fin. Tourner directement en
  coordonnées normalisées déformerait l'angle avec le rapport de l'écran.
- **La largeur est une fraction de la largeur du viseur.** Elle se transporte
  d'une orientation d'écran à l'autre tant que le véhicule occupe la même part
  de la largeur du cadre. Les tests le vérifient en portrait, en paysage et sur
  un écran très allongé.

Les tests rejouent la mesure des photos (même rectangle d'aire minimale) sur le
gabarit produit et la comparent au tableau ci-dessus : ils testent ce que voit
l'utilisateur, pas les constantes d'entrée.

### La position : là où tombe la plaque, pas au milieu de l'écran

Un gabarit centré sur les quatre vues obligeait l'utilisateur à centrer sa
**plaque**, donc à décadrer son véhicule. Sur un 3/4 avant gauche, la plaque
tombe naturellement en bas à gauche du cadre.

`plateCenterForStep(stepId, aspect)` place donc le gabarit là où la plaque
atterrit quand le véhicule est bien cadré : aligner la plaque revient à cadrer
le véhicule, d'un seul geste. Les valeurs viennent des mêmes photos —
part de la largeur du cadre occupée par le véhicule, rapport hauteur/largeur
apparent, et position du cache dans ce rectangle :

| Vue | Véhicule (% largeur) | H/L apparent | Cache dans le véhicule |
|---|---|---|---|
| 3/4 avant gauche | 72,0 % | 0,538 | 12,5 % / 88,8 % |
| Face avant | 59,4 % | 0,823 | 52,2 % / 96,3 % |
| 3/4 avant droit | 78,7 % | 0,522 | 89,5 % / 87,1 % |
| Arrière | 65,9 % | 0,743 | 53,8 % / 89,5 % |

Formuler la position ainsi — plutôt que « le cache est à 75 % de la hauteur » —
est ce qui la rend juste dans les deux orientations : en portrait le véhicule
occupe moins de hauteur, donc la plaque remonte dans le cadre. Sur un écran de
téléphone, ça donne (23 %, 59 %) pour le 3/4 gauche et (81 %, 59 %) pour le
3/4 droit ; sur un 4:3 paysage, (23 %, 70 %) et (81 %, 70 %).

Un garde-fou empêche le gabarit de sortir du cadre sur un écran très allongé :
invisible, il serait invisable.

### Mode paysage

Les photos d'annonce se prennent téléphone à l'horizontale. Deux cas :

- **Rotation d'écran non verrouillée** : la page pivote toute seule, le viseur
  se remesure, le gabarit suit. Rien à faire — les commandes d'orientation sont
  alors masquées.
- **Rotation verrouillée** (le cas courant sur iPhone) : la page reste en
  portrait. L'image de la caméra, elle, apparaît bien à l'endroit — c'est
  l'**interface** qui est de travers, puisque l'image suit le capteur et non
  l'interface.

Dans le second cas, l'interface entière (la « scène ») est pivotée de 90°, et
**la vidéo est contre-pivotée d'autant** pour rester droite à l'écran. La photo
produite est tournée du même angle : elle sort en paysage, à l'endroit.

Le sens de rotation ne peut pas être deviné : avec le verrouillage actif, ni
`screen.orientation` ni `window.orientation` ne bougent, et demander l'accès
aux capteurs de mouvement pour ça serait une permission de trop. D'où un bouton
`↻` pour retourner le sens. Le choix — paysage ou portrait, et le sens — est
mémorisé localement. Le paysage est le réglage par défaut.

### Le cadre 4:3

Un écran de téléphone fait 2:1 ou plus. Capturer « tout ce qui reste à
l'écran » donnait un panorama 3,2:1, à des lieues d'une photo d'annonce. Le
viseur est donc un **cadre 4:3 centré**, le reste devenant bande noire — comme
dans un appareil photo.

Deux bénéfices en plus du format : les commandes se logent dans la bande libre
(colonne sur le côté quand la scène est large, bandeau en bas sinon), et
surtout le gabarit du cache retrouve **exactement** les conditions dans
lesquelles il a été mesuré. En paysage, il tombe à (23 %, 70 %) pour le 3/4
avant gauche — la valeur relevée sur la photo de référence.

### « Ce qui est visé est ce qui est capturé »

Le viseur affiche la vidéo en `object-fit: cover`, donc **recadrée**. Capturer
l'image vidéo entière donnerait une photo plus large que ce que l'utilisateur a
cadré — et le cache ne tomberait plus au même endroit. `coverSourceRect()`
calcule la zone réellement visible, et c'est elle seule qui est dessinée dans
le canvas de capture. Les coordonnées normalisées du viseur valent alors telles
quelles dans le fichier produit, sans conversion.

### La visée n'écrase pas la détection

> ⚠️ Section de conception : `plateHint` n'existe pas dans le code — les
> détecteurs de repli ayant été retirés, le modèle keypoints local est seul, et
> la visée du parcours n'est utilisée que par `plateFromGuidedQuad` (les quatre
> vues du parcours, décrites plus haut).

L'idée reste valable pour les photos bonus : la visée ne court-circuiterait
**aucun** détecteur — le modèle keypoints reste plus précis qu'un cadrage à
main levée. Elle servirait de **filet de sécurité**, quand le modèle rend
« aucune plaque » alors que l'utilisateur en a visé une : le cache serait posé
sur la visée plutôt que pas du tout. C'est le cas qui compte — sur ces
photos-là, il y a forcément une plaque, l'utilisateur l'a mise dans le cadre
lui-même.

Le gabarit est volontairement un peu généreux (plancher à 16 %) : le sens du
risque est asymétrique. Un cache qui déborde sur le pare-chocs s'ajuste en
trois secondes ; une plaque restée lisible, non.

---

## 4. Points de conception

- **Les photos s'ajoutent au lot, elles ne le remplacent pas.** Contrairement
  au scan 360° (`handleCapturedViews`), le parcours ne décrit pas un ordre
  circulaire à préserver : on peut enchaîner un parcours et des photos
  importées, ou plusieurs véhicules.
- **Reprendre une vue la remplace.** Rephotographier la « face avant » écrase la
  précédente au lieu d'empiler deux photos de face : quatre vues demandées,
  quatre vues livrées.
- **L'ordre du parcours survit à l'export.** `orderedShots()` renomme les
  fichiers `parcours_01_avant-34-gauche.jpg` … `parcours_05_bonus-01.jpg` :
  l'ordre de l'annonce tient au tri alphabétique, donc jusque dans l'envoi par
  mail.
- **On peut commencer par la vue qu'on veut.** Les quatre onglets sont
  cliquables. L'ordre proposé est une aide, pas une contrainte — un véhicule
  contre un mur impose parfois de commencer par l'arrière.
- **Le bouton est neutre, pas orange.** C'est une option, pas le chemin
  principal. En orange, il attirait le clic d'un nouvel arrivant qui voulait
  simplement importer ses photos — et tombait sur une demande d'accès à la
  caméra. Un avertissement explicite précède désormais l'ouverture du viseur,
  avec un « ne plus afficher » stocké en local (préférence d'appareil : c'est
  l'appareil qui a, ou non, une caméra).
- **Le contrôle qualité ne bloque pas.** Il affiche « stabilisez l'appareil » ou
  « surexposé » sous la consigne. Un déclencheur grisé sur une photo que
  l'utilisateur juge bonne serait une régression, pas une aide.
- **Le format de sortie suit l'orientation du viseur** : 4:3 paysage quand la
  scène est large, 3:4 quand elle est haute. Jamais le format de l'écran.
- **Le flux caméra est rebranché à chaque retour au viseur.** L'écran de revue
  démonte la balise `<video>` ; sans rebranchement, revenir prendre une photo
  bonus donnait un écran noir.

---

## 5. Ce que ça ne fait pas

- **Pas de détection du véhicule dans le viseur.** Rien ne vérifie que la
  voiture est bien alignée : le repère visuel (le cache + l'axe vertical) fait
  le travail, gratuitement. Le modèle ONNX local (`plate-keypoints.onnx`)
  pourrait confirmer en direct que la plaque est bien dans le cache — piste
  ouverte, non faite.
- **Pas de tour 360°.** Quatre vues ne font pas une rotation.
- **Pas de guidage à la boussole.** Aucun capteur n'est lu : c'est l'utilisateur
  qui sait où il est autour de sa voiture, et la consigne écrite suffit.

---

## 6. Ce qui a été retiré

Le **Showroom interactif** — scan guidé en 36 zones (tour × trois hauteurs)
piloté par la boussole, puis tour 360° au doigt — a été supprimé et remplacé
par ce parcours à cet emplacement. Sont partis avec lui :

```
src/components/ShowroomCapture.jsx   UI de scan
src/components/Spin360.jsx           visualiseur rotatif
src/showroomInteractif.js            logique d'orbite et de couverture
tests/showroomInteractif.test.js
SHOWROOM_INTERACTIF.md
```

Ainsi que, dans `App.jsx`, les états `spin360Mode` / `spinRingCount` /
`showSpinViewer`, le bouton « Tour 360° » de l'écran des résultats et le
drapeau d'accès `showroom_interactif` ; et le code administrateur `AURELE3D`
dans `api/promo.js` (le mécanisme générique de déverrouillage par
`feature`, lui, reste en place pour un usage futur).

Le contrôle local de netteté et d'exposition, seul morceau réutilisé, vit
désormais dans `src/guidedTour.js` (`blurScore`, `meanLuma`, `frameAdvice`).
Tout le reste est récupérable dans l'historique git.

Attention à ne pas confondre avec le **mode Showroom** (fond de studio virtuel,
`showroomActive`, `SHOWROOM_V2.md`) : c'est une autre fonctionnalité, intacte.
