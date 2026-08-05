-- 20260805000000_admin_panel.sql
-- Tables du panneau d'administration : versions des conditions générales,
-- acceptations, journal d'audit.
--
-- À exécuter une fois, dans l'éditeur SQL du projet Supabase.
--
-- Ce qui NE dépend PAS de ce fichier : la liste des clients, les profils, les
-- plans, les quotas, la consommation mensuelle, les suspensions et les
-- bannissements. Tout cela vit dans `auth.users` et dans `app_metadata`, et
-- fonctionne sans aucune migration. Seules la gestion des CGV et la trace
-- d'audit ont besoin des tables ci-dessous.
--
-- Sécurité : RLS est activé sur les trois tables et AUCUNE politique n'est
-- créée. C'est volontaire — sans politique, aucun rôle public (`anon`,
-- `authenticated`) ne peut lire ni écrire quoi que ce soit. Seul le rôle de
-- service, utilisé exclusivement par les fonctions serveur, contourne RLS. Les
-- conditions générales restent lisibles par tous, mais à travers
-- /api/legal-terms, qui ne sert que les colonnes publiables.

-- ── Versions des conditions générales ────────────────────────────────────
-- Une ligne par version publiée. Rien n'est jamais mis à jour ni supprimé :
-- c'est cette immutabilité qui rend le document opposable.
create table if not exists public.legal_documents (
  id            bigint generated always as identity primary key,
  doc_key       text        not null default 'cgv',
  version       integer     not null,
  title         text        not null,
  summary       text        not null,          -- résumé des modifications, communiqué aux clients
  kind          text        not null,          -- substantive | legal | minor
  body          text        not null,          -- texte intégral, en Markdown
  content_hash  text        not null,          -- empreinte du texte : prouve ce qui a été accepté
  notice_days   integer     not null default 30,
  effective_at  timestamptz not null,          -- entrée en vigueur (publication + préavis)
  published_at  timestamptz not null default now(),
  published_by  text,
  created_at    timestamptz not null default now(),
  constraint legal_documents_version_unique unique (doc_key, version),
  constraint legal_documents_kind_check check (kind in ('substantive', 'legal', 'minor'))
);

create index if not exists legal_documents_lookup
  on public.legal_documents (doc_key, version desc);

alter table public.legal_documents enable row level security;

-- ── Acceptations ─────────────────────────────────────────────────────────
-- La preuve : qui a accepté quelle version, quand, et l'empreinte du texte
-- accepté. Une ligne par acceptation ; les doublons sont écartés par la clé
-- (un même compte n'accepte une version qu'une fois).
create table if not exists public.legal_acceptances (
  id            bigint generated always as identity primary key,
  user_id       uuid        not null,
  email         text,
  doc_key       text        not null default 'cgv',
  version       integer     not null,
  content_hash  text        not null,
  accepted_at   timestamptz not null default now(),
  user_agent    text,
  ip            text,
  constraint legal_acceptances_unique unique (user_id, doc_key, version)
);

create index if not exists legal_acceptances_version
  on public.legal_acceptances (doc_key, version, accepted_at desc);

alter table public.legal_acceptances enable row level security;

-- ── Journal d'audit ──────────────────────────────────────────────────────
-- Toute action d'administration : changement de plan, octroi de crédits,
-- suspension, bannissement, publication de CGV. L'écriture est « au mieux » —
-- une action n'échoue jamais parce que le journal est indisponible — mais elle
-- est doublée, pour les sanctions, dans l'historique du compte concerné.
create table if not exists public.admin_audit_log (
  id             bigint generated always as identity primary key,
  actor_email    text        not null,
  action         text        not null,
  target_user_id uuid,
  target_email   text,
  details        jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_audit_log_recent
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_target
  on public.admin_audit_log (target_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;
