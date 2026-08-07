# Panneau d'administration

Espace réservé au compte propriétaire : clients, quotas, sanctions, conditions
générales. Accessible depuis **⚙ Menu → Administration**, entrée qui n'apparaît
que pour l'adresse déclarée dans `src/admin.js`.

---

## Qui y a accès

Une seule adresse : **contact.asgs29200@gmail.com**, déclarée dans
`src/admin.js` et partagée par le navigateur et le serveur — une seule
définition, donc aucune divergence possible entre ce qui est affiché et ce qui
est autorisé.

L'autorisation est prononcée par `api/_admin.js`, à partir de l'email porté par
le **jeton de session signé par Supabase**, jamais à partir du corps de la
requête. Trois conditions cumulatives :

1. session valide ;
2. email dans la liste ;
3. **email vérifié** — sans quoi il suffirait de créer un compte portant
   l'adresse du propriétaire pour hériter du panneau ;
4. compte lui-même non sanctionné.

Un compte ordinaire qui appellerait ces routes à la main reçoit `404` — pas
`403` : la réponse ne confirme même pas l'existence du panneau.

Pour ajouter une seconde adresse sans redéployer, définir la variable
d'environnement `ADMIN_EMAILS` (séparateurs : virgule, point-virgule, espace).
Une valeur vide retombe sur le propriétaire, jamais sur « personne ».

---

## Installation

La partie **clients** — liste, profils, plans, quotas, consommation,
suspensions, bannissements — fonctionne **sans aucune installation** : tout
provient de l'API d'administration Supabase et de `app_metadata`.

La partie **conditions générales** (versions, acceptations, journal d'audit) a
besoin de trois tables. Une fois pour toutes, dans l'éditeur SQL du projet
Supabase, exécuter :

```
supabase/migrations/20260805000000_admin_panel.sql
```

Tant que ce n'est pas fait, le panneau affiche la marche à suivre au lieu d'une
erreur, et `/cgv.html` continue d'afficher le texte statique du site.

RLS est activé sur les trois tables **sans aucune politique** : seul le rôle de
service — utilisé exclusivement par les fonctions serveur — y accède. Les CGV
restent publiques, mais via `GET /api/legal`, qui ne sert que les colonnes
publiables.

---

## Onglet « Clients »

| Ce qui est affiché | D'où cela vient |
|---|---|
| Email, vérification, date d'inscription, dernière connexion | `auth.users` |
| Nom, téléphone, email d'export, didacticiel vu | `user_metadata` |
| Plan, formule, origine de l'accès, client Stripe | `app_metadata` |
| Quota en cours, crédits accordés, période | `quotaSnapshot()` |
| Consommation des 12 derniers mois | `app_metadata.photos_monthly` |
| Sanction en cours et historique | `app_metadata.sanction` |
| Version des CGV acceptée | `app_metadata.cgv_accepted` |

Recherche (email, nom, téléphone, identifiant Stripe ou compte), filtres
(abonnés, essai, sous sanction, email non vérifié) et tris s'appliquent à
**l'ensemble** des comptes, pas à la page affichée.

### Actions

- **Ouvrir un abonnement** dans l'une des trois formules, ou **ramener à
  l'essai**. Un accès ouvert ici porte `plan_source: "admin"` : la
  réconciliation Stripe ne le révoque pas, alors qu'elle coupe tout accès payant
  qu'elle ne retrouve pas chez Stripe.
- **Accorder ou retirer des photos.** Les crédits s'ajoutent au quota de la
  formule et ne sont entamés qu'une fois celui-ci épuisé. Ils **survivent au
  renouvellement de la période**, diminués de ce qui a réellement été consommé.
- **Fixer le compteur** ou **réinitialiser la période**.
- **Suspendre** (1 h à 1 an) ou **bannir**, avec motif obligatoire.
- **Lever** une sanction.

### Sanctions : ce qui se passe réellement

Une sanction écrit deux choses dans le même appel : le détail dans
`app_metadata.sanction`, et `ban_duration` sur le compte Supabase. Le second
point est ce qui **révoque les sessions ouvertes** — sans lui, un onglet déjà
connecté continuerait de fonctionner jusqu'à l'expiration de son jeton.

Côté service, `requireUser()` refuse toutes les routes d'un compte sanctionné
avec le motif. Deux exceptions volontaires :

- `/api/billing` (portail client) — un compte suspendu continue d'être prélevé par
  Stripe tant qu'il n'a pas résilié. Couper le service tout en encaissant, sans
  laisser d'issue, ne se défend pas ;
- `POST /api/legal` (acceptation) — accepter des conditions n'est pas utiliser le service.

L'utilisateur voit un écran dédié portant le motif, l'échéance quand la
suspension est temporaire, la voie de contestation et l'accès à la résiliation.
Une suspension temporaire **expire d'elle-même** : aucune intervention n'est
nécessaire.

Un administrateur ne peut ni se sanctionner lui-même, ni sanctionner un autre
administrateur.

---

## Onglet « CGV »

Modifier des CGV, c'est modifier un contrat déjà conclu avec des clients qui
paient. Le panneau encode ce qu'une publication doit respecter.

### Trois natures de modification

| Nature | Préavis | Acceptation | Accès |
|---|---|---|---|
| **Modification substantielle** (tarifs, quotas, durée, résiliation, responsabilité) | 30 jours minimum | demandée | bloqué à défaut de réponse, **après** l'entrée en vigueur |
| **Mise en conformité légale** | immédiat possible | enregistrée | jamais bloqué |
| **Correction de forme** | immédiat | non demandée | jamais bloqué |

### Ce qu'une publication garantit

- **Versionnage** — chaque publication crée une version numérotée. Rien n'est
  jamais modifié en place, rien ne peut être supprimé. Revenir en arrière se
  fait en publiant une nouvelle version reprenant l'ancien texte, ce qui laisse
  la trace du passage et de son retour.
- **Empreinte** — chaque version porte l'empreinte de son texte : ce qui a été
  accepté est prouvable mot pour mot. Une acceptation portant sur une empreinte
  différente ne vaut pas acceptation.
- **Résumé obligatoire** — c'est l'obligation d'information : le client doit
  savoir *ce qui* change.
- **Préavis** — l'entrée en vigueur ne peut pas être antérieure à
  publication + préavis. Une date rétroactive est refusée à la publication.
- **Non-rétroactivité** — pendant le préavis, `/cgv.html` affiche encore la
  version **en vigueur**, et annonce la suivante à côté. Chaque client reste
  régi par la version qu'il a acceptée.
- **Droit de sortie** — l'écran qui demande l'acceptation propose la
  résiliation sans frais sur le même écran. Un refus n'est jamais une impasse.
- **Traçabilité** — acceptations horodatées avec empreinte, adresse IP et
  navigateur (`legal_acceptances`), publications journalisées
  (`admin_audit_log`).

Le texte est saisi en **Markdown**, jamais en HTML : le rendu échappe la
totalité du texte, il n'existe aucun chemin par lequel ce qui est saisi
devienne du balisage. Le même convertisseur sert l'aperçu du panneau et la page
publique — une seule mise en page possible pour un même texte.

### Page publique

`/cgv.html` affiche la version en vigueur, un sélecteur des versions
archivées (`/cgv.html?version=2`), et un bandeau annonçant la version à venir
pendant le préavis.

Le texte statique de la page reste présent en **repli** : il s'affiche tant
qu'aucune version n'a été publiée, et si le chargement échoue — panne réseau,
script bloqué, navigateur sans JavaScript. Une page de conditions générales
vide ne serait opposable à personne.

---

## Points de vigilance

- **Un changement de plan n'est pas instantané à l'écran du client.** Les
  droits d'un compte voyagent dans son jeton de session, figé à son émission.
  Côté serveur, le changement s'applique immédiatement — les routes relisent le
  compte à chaque appel. Côté affichage, le client le voit au **prochain
  chargement de sa page** : l'application relit alors le compte auprès de
  Supabase. Sur votre propre compte, la session est renouvelée sur-le-champ.
- **L'historique de consommation démarre à la mise en service.** Un compte
  ancien affiche `0` sur les mois antérieurs tout en ayant consommé son quota :
  `photos_monthly` n'est alimenté qu'à partir des traitements enregistrés
  depuis ce déploiement. Le quota en cours, lui, est exact.
- **Au-delà de 5 000 comptes**, la liste est tronquée et le panneau le signale.
  Il faudra alors paginer côté base plutôt qu'en mémoire.
- **Modifier le plan ici ne modifie pas la facturation Stripe.** Ouvrir un
  accès à la main n'ouvre pas d'abonnement payant, et le fermer n'interrompt
  aucun prélèvement — cela se fait dans Stripe.
- **Le traitement des photos s'exécute dans le navigateur.** Une sanction
  prononcée pendant qu'un onglet est ouvert bascule celui-ci sur l'écran
  d'explication dès le premier appel au serveur.

---

## Une contrainte d'hébergement à connaître

Vercel compte **une fonction serverless par fichier exposé dans `api/`**, et le
plan Hobby en autorise **douze par déploiement**. Le projet y était déjà quand
le panneau a été ajouté : le build passait, mais la mise en ligne était refusée.

Les routes sont donc regroupées par domaine — `billing.js` (souscription,
portail, réconciliation), `admin.js` (comptes, actions, CGV), `legal.js`
(lecture et acceptation), `account.js` (code administrateur, téléphone). Les
traitements eux-mêmes n'ont pas été fusionnés : ils restent dans des fichiers
préfixés `_`, que Vercel n'expose pas, et les routeurs ne font qu'aiguiller.

Le décompte est aujourd'hui de **11 sur 12**. La prochaine route à ajouter doit
donc soit rejoindre un routeur existant, soit prendre la dernière place — au
treizième fichier exposé, le déploiement échoue de nouveau, avec le même mail
laconique de Vercel.

## Fichiers

| Rôle | Fichier |
|---|---|
| Qui est administrateur | `src/admin.js` |
| Sanctions : forme, durée, expiration | `src/moderation.js` |
| Règles de publication des CGV | `src/legalTerms.js` |
| Rendu Markdown sans HTML | `src/markdownLite.js` |
| Texte de référence des CGV | `src/legalBaseline.js` |
| Quota, crédits, historique | `src/subscriptionQuota.js` |
| Garde et journal d'audit | `api/_admin.js` |
| Routeur d'administration | `api/admin.js` |
| Liste et fiches clients | `api/_adminUsers.js` |
| Actions sur un compte | `api/_adminUserAction.js` |
| Publication des CGV | `api/_adminTerms.js` |
| Lecture publique des CGV | `api/_legalRead.js` (via `api/legal.js`) |
| Acceptation par un client | `api/_legalAccept.js` (via `api/legal.js`) |
| Interface | `src/components/AdminPanel.jsx` |
| Tables | `supabase/migrations/20260805000000_admin_panel.sql` |
