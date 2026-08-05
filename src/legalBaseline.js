// src/legalBaseline.js
// Texte de référence des CGV, en Markdown.
//
// Rôle exact : point de départ de l'éditeur du panneau d'administration. Tant
// qu'aucune version n'a été publiée depuis le panneau, c'est la page statique
// `public/cgv.html` qui fait foi et reste affichée — ce fichier ne la remplace
// pas, il en reprend le contenu pour que la première publication parte du texte
// réellement en vigueur plutôt que d'une page blanche.
//
// La duplication entre les deux est donc voulue et temporaire : dès la première
// publication, la page statique s'efface au profit de la version publiée, et
// c'est cette dernière qui devient la source unique.

export const BASELINE_TITLE = "Conditions Générales de Vente — AutoCache Pro";

// Le résumé décrit ce que le texte de référence apporte par rapport à la page
// statique d'origine : deux clauses qui, précisément, encadrent ce que le
// panneau d'administration permet de faire — modifier les conditions, et
// suspendre un compte. Sans elles, ces deux actions n'auraient aucune base
// contractuelle.
export const BASELINE_SUMMARY =
  "Ajout d'un article 12 encadrant la modification des présentes conditions (résumé des changements, préavis de 30 jours, résiliation sans frais en cas de refus, archivage des versions) et précision à l'article 8 : toute suspension ou résiliation à l'initiative du Prestataire est motivée, notifiée, de durée indiquée et contestable. Le reste du texte est inchangé.";

export const BASELINE_MARKDOWN = `# Mentions Légales

Conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN).

## 1. Éditeur du site

**AutoCache Pro** est édité par :

- Nom / Raison sociale : Autocache Pro
- SIRET : 103 120 853 00017
- Code APE : 6201Z
- Adresse : 17 Route de l'Échangeur, 29860 Kersaint-Plabennec
- Téléphone : 07 83 57 88 70
- Email : contact.asgs29200@gmail.com

## 2. Directeur de la publication

Le directeur de la publication est le représentant légal d'AutocachePro.

## 3. Hébergeur

Le site AutoCache Pro est hébergé par **Vercel Inc.**, 340 Pine Street, Suite 701 — San Francisco, CA 94104, États-Unis — [vercel.com](https://vercel.com).

## 4. Propriété intellectuelle

L'ensemble des éléments composant le site AutoCache Pro (textes, images, logotypes, interface, code source) est la propriété exclusive de l'éditeur. Toute reproduction, représentation, modification ou exploitation, totale ou partielle, par quelque procédé que ce soit, sans autorisation écrite préalable, est strictement interdite et constitue une contrefaçon sanctionnée par les articles L.335-2 et suivants du Code de la propriété intellectuelle.

## 5. Limitation de responsabilité

AutoCache Pro met tout en œuvre pour offrir un service de qualité. Toutefois, la responsabilité de l'éditeur ne saurait être engagée en cas d'interruption de service, de perte de données ou de tout préjudice indirect résultant de l'utilisation du service.

---

# Conditions Générales de Vente

Applicables à tout abonnement souscrit sur autocache.fr.

## Article 1 — Objet

Les présentes Conditions Générales de Vente (CGV) régissent les relations contractuelles entre **AutoCache Pro** (ci-après « le Prestataire ») et tout professionnel (ci-après « le Client ») souscrivant à un abonnement au service de traitement de photos automobiles AutoCache Pro, accessible en ligne.

Le Client déclare avoir pris connaissance des présentes CGV avant toute souscription et les accepter sans réserve.

## Article 2 — Description du service

AutoCache Pro est un outil SaaS (Software as a Service) destiné aux professionnels de l'automobile permettant :

- Le traitement automatisé de photographies de véhicules (cache plaque, fond showroom, amélioration couleurs…)
- L'application d'un logo et d'éléments graphiques personnalisés
- Le téléchargement des photos traitées en haute résolution

Le service est accessible depuis tout navigateur web moderne, sans installation logicielle.

## Article 3 — Offre et tarifs

Le service est proposé sous la forme d'un **abonnement unique** donnant accès à l'intégralité des fonctionnalités disponibles. Cet abonnement se décline en trois formules qui ne diffèrent que par leur cadence de facturation et leur tarif ; les fonctionnalités et le quota de photos sont identiques dans les trois cas.

| Formule | Quota de photos | Tarif | Fonctionnalités |
|---|---|---|---|
| Essai gratuit | 30 (une seule fois) | Gratuit | Découverte du service |
| Abonnement — Hebdomadaire | 250 / semaine | 4,90 € / semaine | Toutes les fonctionnalités |
| Abonnement — Mensuel | 1 000 / mois | 12,90 € / mois | Toutes les fonctionnalités |
| Abonnement — Annuel | 1 000 / mois | 119 € / an | Toutes les fonctionnalités |

La formule annuelle représente 119 € par an au lieu de 154,80 € en cumulant douze échéances mensuelles.

Le quota de photos suit la cadence de facturation de la formule choisie :

- **Formule hebdomadaire** : 250 photos par période de sept jours, réinitialisées à chaque échéance hebdomadaire ;
- **Formules mensuelle et annuelle** : 1 000 photos par mois, réinitialisées chaque mois à la date anniversaire de la souscription — y compris pour la formule annuelle, dont le quota reste mensuel et non annuel.

Les trois formules donnent ainsi accès au même volume mensuel, de l'ordre de 1 000 photos. Les photos non utilisées au cours d'une période ne sont pas reportées sur la suivante. Les 30 photos de l'essai gratuit sont offertes une seule fois par compte et ne font l'objet d'aucun renouvellement.

Les prix sont indiqués en euros. Le Prestataire étant auto-entrepreneur, la TVA n'est pas applicable conformément à l'article 293 B du CGI. Le Prestataire se réserve le droit de modifier ses tarifs à tout moment ; les modifications tarifaires sont notifiées au Client avec un préavis de 30 jours par email.

## Article 4 — Offre de bienvenue

Pour toute première souscription à la formule mensuelle ou annuelle, une remise de **5 €** est appliquée automatiquement sur la première échéance. Cette offre est valable une seule fois par compte et ne peut être cumulée avec d'autres promotions. Elle ne s'applique pas à la formule hebdomadaire, qui constitue déjà l'offre d'entrée.

## Article 5 — Modalités de paiement

Le paiement est effectué par prélèvement automatique sur carte bancaire, selon la cadence de la formule choisie — hebdomadaire, mensuelle ou annuelle — via la plateforme de paiement sécurisée **Stripe**. Le Prestataire n'a accès à aucune donnée bancaire du Client ; celles-ci sont traitées exclusivement par Stripe conformément à la norme PCI DSS.

En cas d'échec du prélèvement, l'accès aux fonctionnalités payantes est suspendu immédiatement et l'abonnement **n'est pas renouvelé** tant que le paiement n'a pas abouti. Le Client conserve un accès limité correspondant à l'essai gratuit jusqu'à régularisation. Stripe procède automatiquement à de nouvelles tentatives de prélèvement ; dès qu'une tentative aboutit, l'accès complet et le quota mensuel sont rétablis sans intervention du Client. Si aucune tentative n'aboutit, l'abonnement est résilié de plein droit.

## Article 6 — Durée et renouvellement

L'abonnement est souscrit pour la durée de la formule choisie — une semaine, un mois ou un an — renouvelable tacitement à chaque échéance. Le renouvellement est automatique sauf résiliation par le Client avant la date d'échéance.

L'abonnement est **sans engagement de durée** : le Client peut y mettre fin à tout moment, sans préavis ni frais, dans les conditions de l'article 8.

## Article 7 — Droit de rétractation

Conformément à l'article L.221-28 du Code de la consommation, le droit de rétractation ne s'applique pas aux services pleinement exécutés avant la fin du délai de rétractation, lorsque le Client a expressément demandé l'exécution immédiate du service.

En souscrivant à un abonnement AutoCache Pro et en accédant immédiatement au service, le Client renonce expressément à son droit de rétractation.

Toutefois, par engagement commercial, AutoCache Pro offre un remboursement intégral de la première échéance si le Client en fait la demande dans les **48 heures** suivant la souscription, à condition qu'il n'ait pas traité plus de 10 photos.

## Article 8 — Résiliation

Le Client peut résilier son abonnement **à tout moment**, sans préavis, sans frais et sans avoir à motiver sa demande, depuis la rubrique *Mon Abonnement* de son espace personnel, au moyen du bouton *Résilier mon abonnement* qui ouvre le portail client Stripe.

La résiliation produit les effets suivants, appliqués automatiquement :

- **Aucun nouveau prélèvement** n'est effectué à compter de la demande ;
- le Client **conserve l'intégralité de son accès et de son quota jusqu'au terme de la période déjà réglée**, dont la date lui est affichée dans son espace personnel ;
- à cette échéance, le compte revient automatiquement à l'accès limité de l'essai gratuit, sans autre démarche.

Aucun remboursement au prorata de la période en cours n'est effectué, celle-ci restant intégralement utilisable. Le Client peut souscrire à nouveau à tout moment.

Le Prestataire se réserve le droit de suspendre ou de résilier sans préavis tout compte en cas de violation des présentes CGV, d'usage frauduleux ou abusif du service. Toute suspension ou résiliation à l'initiative du Prestataire est motivée et notifiée au Client, qui dispose de la faculté de la contester par écrit à l'adresse de contact indiquée à l'article 13. Lorsque la suspension est temporaire, sa durée est indiquée au Client.

## Article 9 — Utilisation du service

Le Client s'engage à utiliser AutoCache Pro exclusivement à des fins professionnelles légitimes. Il lui est notamment interdit de :

- Contourner ou tenter de contourner les mécanismes de contrôle d'accès
- Revendre, sous-licencier ou partager son accès à des tiers
- Traiter des images portant atteinte à des droits de tiers
- Surcharger délibérément l'infrastructure du service

## Article 10 — Disponibilité du service

AutoCache Pro s'engage à maintenir un taux de disponibilité de 99 % par mois. Des interruptions de service peuvent survenir pour maintenance, sans que cela ouvre droit à indemnisation, sauf interruption prolongée dépassant 72 heures consécutives.

## Article 11 — Responsabilité

AutoCache Pro est une obligation de moyens. La responsabilité du Prestataire est limitée au montant des sommes effectivement payées par le Client au cours du mois précédant le litige. En aucun cas le Prestataire ne saurait être tenu responsable de tout préjudice indirect (manque à gagner, perte de clientèle, etc.).

## Article 12 — Modification des présentes conditions

Le Prestataire peut faire évoluer les présentes CGV. Toute modification substantielle — portant notamment sur les tarifs, les quotas, la durée, la résiliation ou la responsabilité — est portée à la connaissance du Client par tout moyen, accompagnée d'un résumé des changements, et n'entre en vigueur qu'au terme d'un préavis de **30 jours**.

Pendant ce préavis, le Client demeure régi par la version qu'il a acceptée. S'il refuse la nouvelle version, il peut résilier son abonnement sans frais ni pénalité avant son entrée en vigueur, dans les conditions de l'article 8. La poursuite de l'utilisation du service après l'entrée en vigueur vaut acceptation.

Les corrections de forme et les mises en conformité imposées par une évolution légale ou réglementaire peuvent entrer en vigueur immédiatement ; le Client en est informé.

Chaque version des présentes conditions est numérotée, horodatée et archivée. Les versions antérieures restent consultables et la version applicable à un Client est celle qui était en vigueur à la date des faits considérés.

## Article 13 — Droit applicable et litiges

Les présentes CGV sont soumises au droit français. En cas de litige, les parties s'efforceront de trouver une solution amiable. À défaut, le litige sera soumis aux tribunaux compétents du ressort du siège social du Prestataire.

Conformément à l'article L.616-1 du Code de la consommation, le Client professionnel peut recourir à un médiateur de la consommation en cas de litige non résolu.

## Article 14 — Contact

Pour toute question relative aux présentes CGV :

- Email : [contact.asgs29200@gmail.com](mailto:contact.asgs29200@gmail.com)
- Téléphone : [07 83 57 88 70](tel:+33783578870)
`;
