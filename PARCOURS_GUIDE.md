# Parcours photo guidé — le cache plaque dans le viseur

Disponible pour tous, sans code d'accès. Le bouton apparaît dans **02 — Photos
de véhicules** dès que la page a accès à une caméra (`getUserMedia`, donc HTTPS
ou localhost).

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

À la sortie, les photos rejoignent le lot courant et **passent par le pipeline
habituel** : détection de plaque, fond, colorimétrie. Tout reste ajustable
ensuite — déplacer le cache, en ajouter un deuxième, rogner, changer le fond.

---

## 2. Coût

**Zéro appel API pendant la prise de vue.** Le contrôle d'exposition et de
netteté est un calcul local sur le flux vidéo (96 × 72 px, 4 fois par seconde),
et il est **indicatif** : il conseille, il ne bloque jamais le déclencheur.
C'est l'utilisateur qui décide si sa photo à contre-jour lui convient.

Les photos consomment ensuite le quota habituel, comme des photos importées.

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
| `handleGuidedPhotos` | ajoute les photos au lot, avec leur `plateHint` |
| `plateFromGuidedHint` | transforme une visée en résultat de détection |
| `detectPlate(file, regions, hintQuad)` | 3ᵉ paramètre : la visée |
| `startPlateJob` | transmet le `plateHint` de chaque photo au préfetch |

### Le gabarit du cache

`plateQuadForStep(stepId, aspect)` rend un quadrilatère normalisé (0–1) sur la
zone visible du viseur. Trois choses s'y jouent :

- **Le rapport 520/110** d'une plaque française est tenu **en pixels**, donc
  `aspect` (largeur/hauteur du viseur) est obligatoire : les coordonnées
  normalisées x et y n'ont pas la même échelle.
- **La taille suit l'encombrement apparent du véhicule** (`plateWidthForYaw`).
  De face, une plaque fait ~26 % de la largeur du cadre. De 3/4, la *longueur*
  du véhicule entre aussi dans le cadre : il paraît deux fois plus large et
  tout rapetisse. Un simple `cos(angle)` donnerait un gabarit deux fois trop
  grand — l'utilisateur devrait coller le pare-chocs pour l'y faire entrer. Un
  plancher à 16 % garde malgré tout une cible visable.
- **Les vues 3/4 sont des trapèzes** : bord proche plus haut que bord lointain.
  Un rectangle parfait sur une vue de biais ne ressemblerait à aucune plaque
  réelle.

Le cache reste **centré horizontalement** sur toutes les vues, y compris les
3/4 où la plaque d'une voiture centrée serait un peu décalée. C'est un choix
d'usage : centrer la plaque donne un repère unique, et la composition qui en
découle (le véhicule qui se développe d'un côté) est celle des photos
d'annonce.

### « Ce qui est visé est ce qui est capturé »

Le viseur affiche la vidéo en `object-fit: cover`, donc **recadrée**. Capturer
l'image vidéo entière donnerait une photo plus large que ce que l'utilisateur a
cadré — et le cache ne tomberait plus au même endroit. `coverSourceRect()`
calcule la zone réellement visible, et c'est elle seule qui est dessinée dans
le canvas de capture. Les coordonnées normalisées du viseur valent alors telles
quelles dans le fichier produit, sans conversion.

### La visée n'écrase pas la détection

`plateHint` ne court-circuite **aucun** détecteur : le modèle keypoints local,
Plate Recognizer et Claude restent plus précis qu'un cadrage à main levée. La
visée sert à deux endroits :

- **Filet de sécurité** — quand toute la chaîne rend « aucune plaque » alors que
  l'utilisateur en a visé une, le cache est posé sur la visée plutôt que pas du
  tout. C'est le cas qui compte : sur ces photos-là, il y a forcément une
  plaque, l'utilisateur l'a mise dans le cadre lui-même.
- **Localisation pour Claude** — la visée remplace la passe `locate` (une
  requête économisée) quand Plate Recognizer est indisponible.

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
- **Le contrôle qualité ne bloque pas.** Il affiche « stabilisez l'appareil » ou
  « surexposé » sous la consigne. Un déclencheur grisé sur une photo que
  l'utilisateur juge bonne serait une régression, pas une aide.
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
- **Pas de tour 360°.** Quatre vues ne font pas une rotation ; c'est le rôle du
  *Showroom interactif* (`SHOWROOM_INTERACTIF.md`), qui reste accessible par
  code administrateur.
- **Pas de guidage à la boussole.** Aucun capteur n'est lu : c'est l'utilisateur
  qui sait où il est autour de sa voiture, et la consigne écrite suffit.
