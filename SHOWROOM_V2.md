# Showroom V2 — plan pour un rendu ultra-réaliste

Objectif : passer d'un compositing 2D « collage » à un rendu de niveau
professionnel (détourage parfait, ombres et reflets physiquement
cohérents), quitte à introduire un coût par image et un palier
d'abonnement dédié.

---

## 1. État actuel du mode showroom

Le pipeline est **100 % côté navigateur** (sauf la détection de
véhicules) :

```
Photo originale
  │
  ├─ /api/detect-vehicles (Claude Haiku, Vercel)  → bboxes véhicule
  │    principal + voisins (repli : heuristiques locales)
  │
  ├─ @imgly/background-removal (ONNX dans le navigateur)
  │    modèle "medium", entrée plafonnée à 2000 px (1400 px mobile)
  │
  ├─ Nettoyage heuristique du cutout (App.jsx)
  │    isolateMainVehicle (composantes connexes)
  │    separateAttachedSecondary (voisins collés)
  │    hardGateByVehicleBox (garde-fou bbox)
  │
  └─ compositeCarOnBg (canvas 2400×1350)
       décor statique (4 JPEG dans /public/showrooms) + logo mural
       + fondu colorimétrique optionnel (exposition/BdB/saturation)
       + cache plaque redessiné par-dessus
       → PAS d'ombre (supprimée au commit 3c7fcf7)
```

### Pourquoi la qualité plafonne

| Problème constaté | Cause racine |
|---|---|
| Découpage imparfait (jantes, vitres, antennes, dessous de caisse) | Modèle de segmentation généraliste, résolution d'entrée plafonnée, pas de *matting* (transparence progressive des contours) |
| Ombre « ridicule » → supprimée | 4 approches procédurales tentées (silhouette, flaque en perspective, hybride, transcription de la vraie ombre). Aucune ne peut être réaliste sans comprendre la géométrie 3D et l'éclairage de la scène |
| Voiture « collée » sur le décor | Perspective de la photo (hauteur/angle caméra) ≠ perspective du décor statique ; aucun reflet au sol, aucun ré-éclairage |

Conclusion : **ce n'est pas un problème de réglage, c'est un plafond
architectural**. Un canvas 2D côté client ne produira jamais un rendu
« studio ». Les acteurs du marché (Spyne, CarCutter, Photoroom…)
passent tous par des modèles serveur spécialisés ou génératifs.

---

## 2. Cible : deux étages de qualité

### Étage A — « Showroom Pro » : détourage + ombre via API spécialisée

Remplacer @imgly par une **API de détourage automobile côté
serveur**, qui fournit aussi une **ombre générée par IA** :

- **Photoroom API** : détourage + « AI Shadows » (ombre voiture
  réaliste), ~0,02–0,10 € /image selon volume.
- **remove.bg** : `type=car` + add-on ombre voiture + vitres
  semi-transparentes, ~0,13–0,25 € /image.
- Alternative auto-hébergée : **BiRefNet-HR** (open source, état de
  l'art) sur un endpoint GPU (Replicate/Modal), ~0,01 € /image, mais
  ombre à résoudre séparément → moins recommandé en premier.

Architecture :

- Nouvel endpoint Vercel `/api/showroom-cutout` (proxy avec clé API,
  contrôle du quota, jamais de clé côté client).
- Le reste du pipeline **ne change pas** : `compositeCarOnBg` reçoit
  le cutout haute qualité + un **calque ombre séparé** dessiné sous la
  voiture. Nudge/zoom/blend/plaque/logo mural continuent de marcher.
- Les heuristiques locales (isolation du véhicule principal) restent
  en garde-fou, et @imgly reste le **repli gratuit/dégradé**.

Gain : corrige les **deux** problèmes cités (découpage + ombre) avec
un chantier modeste, un rendu déterministe (les pixels de la voiture
ne sont pas modifiés) et une latence faible (~1–3 s/photo).

### Étage B — « Showroom Ultra » : rendu génératif complet

Pour le rendu « publicité constructeur » : confier la scène entière à
un **modèle génératif d'édition d'image** qui replace la voiture dans
le décor avec ombres portées, reflets au sol et éclairage cohérents :

- **Gemini image** (Nano Banana) : ~0,04 $ /image, excellent en
  préservation du sujet.
- **Flux Kontext Pro** (Black Forest Labs) : ~0,04–0,08 $ /image.
- Entrée : photo originale + image du décor choisi en référence +
  prompt strict (« ne modifie ni la carrosserie, ni les jantes, ni la
  plaque, ni les autocollants »).

Architecture :

- Endpoint `/api/showroom-render` (Vercel) : appel modèle, retries,
  contrôle quota, repli automatique sur l'étage A en cas d'échec.
- **Garde-fous fidélité** (indispensable pour un usage pro) :
  1. Comparaison crop-voiture avant/après (similarité perceptuelle) ;
     si le modèle a « inventé » des détails → retry ou repli étage A.
  2. Plaque : le cache plaque actuel est dessiné d'après les coins
     détectés sur la photo d'origine ; en génératif la voiture peut
     bouger de quelques pixels → **re-détecter la plaque sur l'image
     générée** (le modèle keypoints local tourne dans le navigateur) ou
     masquer la plaque AVANT génération.
- Latence 10–30 s/photo → UI de progression (LoadingGame existe déjà),
  traitement en file avec parallélisme limité.
- Nudge/zoom manuels n'ont plus de sens sur un rendu génératif →
  bouton « Regénérer » + choix de décor à la place.

---

## 3. Monétisation

Aujourd'hui : abonnement unique « premium » (hebdo/mensuel/annuel,
mensuel à 14,90 €), quota 300 photos/mois (`photos_used` dans les
métadonnées utilisateur), showroom inclus dès l'essai.

Proposition :

| Palier | Contenu showroom | Prix indicatif |
|---|---|---|
| Premium (existant) | Showroom actuel (repli @imgly) ou étage A avec petit quota | 14,90 €/mois |
| **Showroom Pro** (nouveau) | Étage A illimité (dans le quota 300) + étage B avec quota dédié (ex. 100 rendus Ultra/mois) | ~29–39 €/mois |

- Coût marginal : 300 rendus Ultra ≈ 12 $ + étage A ≈ 6–30 € → marge
  saine dès 29 €/mois ; à vérifier avec les grilles tarifaires à jour
  des fournisseurs avant de fixer le prix.
- Implémentation : nouveau price Stripe (`STRIPE_SHOWROOM_PRICE_ID`),
  metadata `plan: "showroom_pro"` dans le webhook existant, gating
  frontend `canUseShowroomPro` à côté de `canUseShowroom`, compteur
  séparé `showroom_renders_used` remis à zéro avec le quota mensuel.
- L'essai gratuit garde l'accès vitrine : 2–3 rendus Ultra offerts
  (c'est l'argument de vente le plus visuel du produit).

---

## 4. Phasage

| Phase | Contenu | Durée estimée |
|---|---|---|
| **0 — Bench** | Prendre 10 vraies photos à problème (découpage raté, ombres dures, voisins collés) et les passer dans Photoroom, remove.bg, Gemini image, Flux Kontext. Comparer rendu/coût/latence sur un tableau. **Décision fournisseur sur preuves, pas sur plaquette.** | 1–2 jours |
| **1 — Étage A en prod** | ✅ Implémenté : `/api/showroom-cutout` (Photoroom ou remove.bg, ombre IA dans l'alpha du cutout) ; @imgly en repli automatique. Activation par variable d'environnement Vercel : `PHOTOROOM_API_KEY` **ou** `REMOVEBG_API_KEY` (+ options `SHOWROOM_CUTOUT_PROVIDER`, `SHOWROOM_CUTOUT_SHADOW=off`). Débrayable côté client avec `?proCutout=off`. ⚠️ Smoke-test à faire avec une vraie clé : les paramètres exacts des APIs n'ont pas pu être vérifiés en ligne depuis l'environnement de dev. | ~1 semaine |
| **2 — Palier Stripe** | Price « Showroom Pro », webhook, gating UI, compteur de rendus. | 2–3 jours |
| **3 — Étage B en bêta** | `/api/showroom-render` + garde-fous fidélité + re-détection plaque + UI (Regénérer, choix décor). Bêta sur comptes volontaires. | 1–2 semaines |
| **4 — Finitions** | Décors additionnels adaptés à la perspective, décors personnalisés à l'image de la concession (logo/couleurs), presets d'export. | continu |

## 5. Risques et parades

- **Fidélité générative** (jantes redessinées, badge modifié) : garde-fou
  de similarité + repli étage A + mention « rendu IA » dans l'UI.
- **Conformité plaque** : la plaque doit rester masquable → re-détection
  sur l'image générée, jamais de plaque inventée par le modèle.
- **Coût variable** : quota strict par abonnement, compteur serveur
  (jamais uniquement côté client), alerte à 80 %.
- **Dépendance fournisseur** : l'étage A garde @imgly en repli ; le
  bench de la phase 0 doit retenir un fournisseur principal + un
  secondaire interchangeables derrière le même endpoint.
- **Latence Ultra** : file d'attente avec progression, jamais de
  traitement bloquant l'UI ; les photos sans rendu Ultra sortent en
  étage A plutôt qu'en erreur.
