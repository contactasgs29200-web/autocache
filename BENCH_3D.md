# Bench 3D — décider sur pièces avant d'écrire une ligne de code

Objectif : savoir si un **vrai scan 3D** d'un véhicule (photogrammétrie ou
Gaussian Splatting) donne un résultat exploitable pour AutoCache, **avant**
d'engager des semaines de développement et un coût par scan.

Coût du bench : quelques euros et une demi-journée. Coût d'un développement à
l'aveugle : plusieurs semaines, pour un résultat qui peut être inutilisable
pour les trois raisons du §5.

---

## 1. Ce qu'on cherche à savoir

Trois questions, dans cet ordre. Si la réponse à la première est non, les deux
autres ne se posent plus.

| # | Question | Critère de réussite |
|---|---|---|
| 1 | La carrosserie est-elle reconstruite proprement ? | Pas de trou ni de bosse sur le capot, le toit, les portières. Jantes lisibles. |
| 2 | Le véhicule reste-t-il crédible sous un angle non photographié ? | Une vue à 45° entre deux prises ne montre ni fantôme ni déformation. |
| 3 | Peut-on le poser dans un décor sans que l'éclairage jure ? | Voir §5 — c'est la question qui tue, et elle ne se voit qu'à cette étape. |

---

## 2. Véhicules à scanner

**Deux voitures, pas une.** Le résultat dépend énormément de la peinture.

| Véhicule | Pourquoi |
|---|---|
| **Une noire ou gris foncé métallisée, propre** | Cas le plus difficile : vernis miroir, reflets qui se déplacent avec la caméra. Si ça passe ici, ça passe partout. |
| **Une blanche ou claire mate** | Cas favorable. Sert de témoin : si elle rate aussi, le problème vient du protocole de capture, pas du sujet. |

Ajouter une troisième voiture n'apporte rien à ce stade.

---

## 3. Protocole de capture

À faire **manuellement au téléphone**, pas avec le scan intégré : on teste le
plafond de la technique, pas notre UI.

- **Nombre de photos** : 120 à 200 par véhicule. En dessous de 100, un échec
  ne prouve rien.
- **Trois tours complets**, à trois hauteurs :
  1. hauteur genoux (bas de caisse, jantes, bas de portières) ;
  2. hauteur poitrine (ligne de ceinture, portières, poignées) ;
  3. bras levé, appareil incliné vers le bas (capot, toit, pavillon).
- **Recouvrement** : une photo tous les 5 à 8° environ, soit ~50 à 70 par tour.
  Deux photos consécutives doivent partager au moins 60 % de contenu.
- **Distance constante**, 2,5 à 4 m. Ne pas zoomer.
- **Rester net** : pas de flou de bougé, c'est la première cause d'échec.
- **Ne pas oublier** : les quatre angles à 45° (3/4 avant gauche/droit,
  3/4 arrière gauche/droit) — ce sont les vues que le concessionnaire voudra.

### Conditions à respecter

| Condition | Pourquoi |
|---|---|
| **Ciel couvert, ou ombre uniforme** | Le soleil direct crée des reflets spéculaires durs qui font échouer la reconstruction. |
| **Sol dégagé sur 360°** | Il faut pouvoir tourner sans obstacle. Un mur à 1 m ampute le tour. |
| **Fond immobile** | Pas de passants, pas de voitures qui bougent, pas d'arbres au vent. |
| **Véhicule immobile** | Évidemment — mais aussi : ne pas le déplacer entre deux tours. |
| **Noter l'heure et la météo** | Elles conditionnent l'éclairage cuit dans le modèle (§5). |

---

## 4. Où faire tourner le calcul

Ne rien auto-héberger pour le bench. Utiliser un service hébergé, payer à
l'usage, comparer.

Deux familles à tester, une de chaque au minimum :

- **Gaussian Splatting** — la technique qui a rendu le scan automobile
  crédible : elle modélise la couleur dépendante de l'angle, donc encaisse
  bien mieux le vernis que la photogrammétrie classique. C'est le candidat
  principal.
- **Photogrammétrie classique** (maillage texturé, type COLMAP / RealityCapture)
  — sert de point de comparaison. Un maillage est plus facile à intégrer dans
  un moteur 3D et à ré-éclairer, mais échoue plus souvent sur la carrosserie.

Plusieurs plateformes de calcul à la demande (type Replicate, Modal, ou les
services de scan 3D grand public) exposent ces modèles sans infrastructure à
monter. **Vérifier les tarifs au moment du bench** — ils bougent vite, et
l'estimation de 0,30 à 1,50 € par scan donnée jusqu'ici est un ordre de
grandeur, pas un devis.

**Noter pour chaque essai** : durée de calcul, coût réel facturé, poids du
fichier de sortie.

---

## 5. La question qui décide de tout

**Le scan capture l'éclairage du lieu de capture.**

Un modèle scanné sur le parking contient, cuits dans sa surface, le ciel gris,
le bâtiment d'en face et le bitume — visibles dans les reflets de la
carrosserie. Placé dans un showroom virtuel, le véhicule restera éclairé comme
dehors.

Ré-éclairer un Gaussian Splatting (décomposer albédo, rugosité, normales et
illumination) est un problème de recherche ouvert, pas une brique à brancher.

**Le test à faire, et il est décisif** : une fois le modèle obtenu, l'afficher
sur un fond de showroom clair, et se demander honnêtement — *est-ce que ça
ressemble à une voiture en showroom, ou à une voiture de parking découpée et
collée sur un showroom ?*

Si la réponse est la seconde, on aura résolu la géométrie, la perspective et
l'ombre pour introduire une incohérence d'éclairage — et le résultat ne sera
pas meilleur que le compositing 2D actuel, pour 100 fois le prix.

---

## 6. Grille de décision

| Résultat | Décision |
|---|---|
| Q1 échoue (trous, bosses sur la carrosserie) | **Stop.** La technique n'est pas mûre pour ce sujet. Rester sur le tour 360°. |
| Q1 et Q2 passent, Q3 échoue (éclairage incohérent) | **Stop pour le showroom.** Envisager éventuellement le modèle 3D comme visualiseur d'annonce autonome, sans décor virtuel. |
| Les trois passent | **Go**, mais en palier payant séparé : crédit par véhicule, jamais dans le quota de 300 photos. Chiffrer le prix à partir du coût réel mesuré au §4. |

---

## 7. Ce qui est déjà prêt si le bench est concluant

Le parcours photo guidé (`src/components/GuidedTour.jsx`, voir
`PARCOURS_GUIDE.md`) apporte déjà la moitié du chemin : accès caméra, capture
recadrée sur la zone visée, gabarit à l'écran, contrôle de netteté et
d'exposition local, écran de revue. Un scan 3D reprendrait cette couche telle
quelle et n'ajouterait que le plan de capture dense (~150 vues au lieu de 4) et
son guidage.

L'ancien Showroom interactif poussait ce guidage jusqu'à une couverture en 36
zones (tour × trois hauteurs) pilotée par la boussole. Il a été retiré du
produit ; son code reste dans l'historique git (voir le commit qui supprime
`src/components/ShowroomCapture.jsx`) et servirait de point de départ si le
bench est concluant.
