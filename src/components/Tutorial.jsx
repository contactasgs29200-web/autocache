import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import SlideFrame from "./SlideFrame.jsx";

const TUTORIAL_BASE = "/tutorial";

/*
 * STEPS — drives the whole tutorial.
 *
 *   mode: "card"      → centred dialog, no spotlight (intro / outro)
 *   mode: "spotlight" → cuts a hole in the dark overlay over `target` and points a tooltip at it
 *   mode: "slide"     → full-screen image walkthrough rendered inside a SlideFrame
 *
 * Slide steps may carry a `frame` config that mocks the real lightbox chrome
 * (title bar + sliders) so the pulse halo can target actual React refs rather
 * than guessed pixel percentages.
 */
const STEPS = [
  // ── Welcome ─────────────────────────────────────────────────────────────
  {
    mode: "card",
    title: "Bienvenue sur AutoCache",
    body: "Ce didacticiel vous guide à travers les principales fonctions de l'application. En quelques clics, vous pourrez apposer votre cache plaque et améliorer vos photos pour vos annonces.",
    icon: "⬡",
  },

  // ── Phase A: UI walkthrough (existing) ─────────────────────────────────
  {
    mode: "spotlight",
    target: "logo",
    title: "01 — Cache plaque",
    body: "Importez votre logo (PNG avec transparence) ou générez-le directement en choisissant texte, police et couleurs. Ce visuel sera automatiquement appliqué sur les plaques d'immatriculation détectées.",
    icon: "⬡",
  },
  {
    mode: "spotlight",
    target: "photos",
    title: "02 — Photos de véhicules",
    body: "Glissez vos photos de véhicules ici ou cliquez pour les sélectionner. Vous pouvez traiter plusieurs photos en une seule fois — l'IA détecte automatiquement les plaques sur chaque image.",
    icon: "◈",
  },
  {
    mode: "spotlight",
    target: "enhancements",
    title: "Améliorations automatiques",
    body: "Activez les options d'amélioration : correction des couleurs, lustrage carrosserie... Chaque option est indépendante et s'applique lors du traitement.",
    icon: "✨",
  },
  // Le Showroom Virtuel n'a pas d'étape ici tant qu'il est en développement
  // (voir SHOWROOM_COMING_SOON dans App.jsx) : le didacticiel ne présente que
  // des fonctions réellement utilisables.
  {
    mode: "spotlight",
    target: "process",
    title: "Lancer le traitement",
    body: "Une fois votre logo chargé et vos photos ajoutées, cliquez ici pour lancer le traitement. L'IA analyse chaque photo, détecte les plaques et applique vos réglages.",
    icon: "▶",
  },
  {
    mode: "spotlight",
    target: "results-tab",
    title: "Onglet Résultats",
    body: "Toutes vos photos traitées arrivent ici. Cliquez sur une photo pour l'ouvrir en plein écran — voyons ensemble ce qui se passe ensuite.",
    icon: "◈",
  },

  // ── Phase B: Immersive slide journey ───────────────────────────────────
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/1-base.jpg`,
    title: "Étape 1 — Photo brute",
    body: "Voici une photo telle qu'importée : véhicule, plaque réelle visible, environnement non préparé. C'est le point de départ.",
    icon: "▢",
    // pas de frame : on affiche la photo brute, plein cadre
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/2-cache-auto.jpg`,
    title: "Étape 2 — Cache plaque posé",
    body: "L'IA détecte la plaque et applique automatiquement votre cache plaque. La plupart du temps, le résultat est immédiatement parfait.",
    icon: "⬡",
    // pas de frame : zoom face avant, photo seule
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/3-cache-ajust.jpg`,
    title: "Étape 3 — Ajuster les coins",
    body: "Si le placement n'est pas parfait, cliquez sur AJUSTER : vous pouvez alors glisser les 4 coins orange pour repositionner le cache au pixel près. Le résultat s'applique en temps réel.",
    icon: "⊞",
    frame: {
      filename: "renault-scenic.jpg",
      buttons: [
        { id: "rogner",  label: "✂ Rogner",  variant: "inactive" },
        { id: "ajuster", label: "⊹ Ajuster", variant: "yellow-active" },
        { id: "termine", label: "✓ Terminé", variant: "yellow-active" },
      ],
      closeButton: true,
      footer: "Glisser un point orange pour repositionner le coin · Le résultat s'applique en temps réel",
      highlight: "ajuster",
    },
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/4-cache-ok.jpg`,
    title: "Étape 4 — Cache plaque validé",
    body: "Voilà le rendu après ajustement, propre et précis. Il ne vous reste plus qu'à télécharger la photo, prête pour votre annonce.",
    icon: "✓",
    frame: {
      filename: "renault-scenic.jpg",
      buttons: [
        { id: "rogner",      label: "✂ Rogner",      variant: "inactive" },
        { id: "ajuster",     label: "⊹ Ajuster",     variant: "yellow-idle" },
        { id: "telecharger", label: "↓ Télécharger", variant: "orange" },
      ],
      closeButton: true,
    },
  },

  // ── Final ──────────────────────────────────────────────────────────────
  {
    mode: "spotlight",
    target: "credits",
    title: "Suivi des crédits",
    body: "Votre compteur de crédits est affiché ici. Cliquez dessus pour voir les détails de votre abonnement et la date de renouvellement.",
    icon: "◎",
  },
  {
    mode: "card",
    title: "Vous êtes prêt !",
    body: "Vous connaissez maintenant les fonctions essentielles d'AutoCache. Vous pouvez revoir ce didacticiel à tout moment depuis le menu Paramètres en haut à droite. Bonne utilisation !",
    icon: "✓",
  },
];

/* ── Hauteur de l'en-tête collant de l'application ── */
const APP_HEADER_H = 56;

/* ── Best tooltip placement around a spotlight rect ──────────────────────────
 * `tooltipH` est la hauteur réelle mesurée de la bulle : sans elle (ancienne
 * estimation fixe à 200 px) la bulle débordait sous l'écran ou se posait
 * par-dessus la zone qu'elle est censée désigner, ce qui est surtout visible
 * sur smartphone. La bulle est bornée par `maxHeight` au lieu de déborder :
 * son texte défile à l'intérieur, la cible reste toujours dégagée.
 */
function computeTooltipPlacement(sr, tooltipW, isMobile, tooltipH) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const GAP = 14, MARGIN = 12, MIN_H = 150;
  const h = tooltipH || 220;
  const clampTop = () => Math.max(MARGIN, Math.min(sr.y, vh - h - MARGIN));

  // Placement latéral : réservé aux grands écrans, où la largeur le permet.
  const spaceRight = vw - (sr.x + sr.w + GAP) - MARGIN;
  const spaceLeft  = sr.x - GAP - MARGIN;
  if (!isMobile && spaceRight >= tooltipW) {
    return { position: "fixed", top: clampTop(), left: sr.x + sr.w + GAP, width: tooltipW, maxHeight: vh - MARGIN * 2 };
  }
  if (!isMobile && spaceLeft >= tooltipW) {
    return { position: "fixed", top: clampTop(), left: sr.x - tooltipW - GAP, width: tooltipW, maxHeight: vh - MARGIN * 2 };
  }

  // Sinon au-dessus ou en dessous : on garde le côté le plus dégagé.
  const spaceBelow = vh - (sr.y + sr.h) - GAP - MARGIN;
  const spaceAbove = sr.y - GAP - MARGIN;
  const left = Math.max(MARGIN, Math.min(sr.x + sr.w / 2 - tooltipW / 2, vw - tooltipW - MARGIN));
  const below = spaceBelow >= spaceAbove;
  const space = below ? spaceBelow : spaceAbove;

  if (space >= MIN_H) {
    const height = Math.min(h, space);
    return {
      position: "fixed", left, width: tooltipW, maxHeight: height,
      top: below ? sr.y + sr.h + GAP : Math.max(MARGIN, sr.y - GAP - height),
    };
  }

  // Cible presque aussi haute que l'écran : aucun côté ne peut accueillir la
  // bulle. On l'ancre en bas, aussi compacte que possible, pour laisser visible
  // la plus grande partie possible de la zone mise en avant.
  const height = Math.max(MIN_H, Math.min(h, Math.round(vh * 0.3)));
  return { position: "fixed", left, width: tooltipW, top: vh - height - MARGIN, maxHeight: height };
}

export default function Tutorial({ onClose, isMobile }) {
  const [step, setStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [animating, setAnimating] = useState(true);
  const [vpSize, setVpSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [isLight, setIsLight] = useState(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light"
  );
  const tooltipRef = useRef(null);
  // Hauteur naturelle de la bulle, mesurée en additionnant ses trois blocs.
  // On mesure le corps via scrollHeight : la valeur reste la hauteur du texte
  // complet même quand `maxHeight` fait défiler le contenu, ce qui évite que
  // la mesure et le placement se rétrécissent mutuellement à chaque rendu.
  const headerRef = useRef(null);
  const bodyRef   = useRef(null);
  const footerRef = useRef(null);
  const [tooltipH, setTooltipH] = useState(0);

  /* ── Suit le thème jour/nuit pour adapter le didacticiel ── */
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsLight(el.getAttribute("data-theme") === "light");
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;
  const isSlide = current.mode === "slide";
  const hasTarget = current.mode === "spotlight" && !!current.target;

  /* ── Preload all slide images once so cross-fades are instant ── */
  useEffect(() => {
    STEPS.forEach(s => {
      if (s.mode === "slide" && s.image) {
        const img = new Image();
        img.src = s.image;
      }
    });
  }, []);

  /* ── Measure target element position (spotlight mode) ── */
  const measureTarget = useCallback(() => {
    setVpSize({ w: window.innerWidth, h: window.innerHeight });

    if (!hasTarget) {
      setSpotlightRect(null);
      setTooltipStyle({});
      return;
    }
    const el = document.querySelector(`[data-tutorial="${current.target}"]`);
    if (!el) {
      setSpotlightRect(null);
      setTooltipStyle({});
      return;
    }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const sr = {
      x: Math.max(0, rect.left - pad),
      y: Math.max(0, rect.top - pad),
      w: rect.width + pad * 2,
      h: rect.height + pad * 2,
    };
    setSpotlightRect(sr);

    // Sur smartphone on prend toute la largeur utile : une bulle plus large
    // est aussi plus courte, donc plus facile à caser sans gêner la cible.
    const tooltipW = isMobile ? window.innerWidth - 24 : 360;
    setTooltipStyle(computeTooltipPlacement(sr, tooltipW, isMobile, tooltipH));
  }, [current.target, hasTarget, isMobile, tooltipH]);

  /* ── Mesure la hauteur réelle de la bulle après chaque rendu ── */
  useLayoutEffect(() => {
    const total = (headerRef.current?.offsetHeight ?? 0)
                + (bodyRef.current?.scrollHeight ?? 0)
                + (footerRef.current?.offsetHeight ?? 0);
    if (total > 0) setTooltipH(prev => (Math.abs(prev - total) > 2 ? total : prev));
  });

  /* ── Scroll target into view + measure (spotlight) ─────────────────── */
  useEffect(() => {
    if (isSlide) return;            // slide measurements handled in SlideFrame
    if (!hasTarget) {
      measureTarget();
      return;
    }
    const el = document.querySelector(`[data-tutorial="${current.target}"]`);
    if (el) {
      // Centrer la cible coupe l'espace libre en deux moitiés dont aucune ne
      // peut accueillir la bulle : c'est ce qui la faisait retomber par-dessus
      // la fonction désignée sur smartphone. On aligne donc la cible juste sous
      // l'en-tête collant, ce qui regroupe tout l'espace restant sous elle.
      // Sur grand écran on ne le fait que pour les cibles hautes : les petites
      // gardent le centrage habituel, la bulle se plaçant alors sur le côté.
      const rect = el.getBoundingClientRect();
      const tall = rect.height > window.innerHeight * 0.45;
      if (isMobile || tall) {
        window.scrollBy({ top: rect.top - (APP_HEADER_H + 20), behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      // Le défilement est animé : on re-mesure jusqu'à ce qu'il soit terminé,
      // sinon la bulle se place d'après une position de cible périmée.
      const timers = [100, 450, 850].map(d => setTimeout(measureTarget, d));
      return () => timers.forEach(clearTimeout);
    } else {
      measureTarget();
    }
  }, [step, current.target, hasTarget, isSlide, isMobile, measureTarget]);

  /* ── Resize / scroll listeners ── */
  useEffect(() => {
    const h = () => { measureTarget(); };
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    return () => {
      window.removeEventListener("resize", h);
      window.removeEventListener("scroll", h, true);
    };
  }, [measureTarget]);

  /* ── Entry fade ── */
  useEffect(() => {
    setAnimating(true);
    const t = setTimeout(() => setAnimating(false), 80);
    return () => clearTimeout(t);
  }, [step]);

  /* ── ESC closes ── */
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  /* ── Arrow-key navigation ── */
  useEffect(() => {
    const h = (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const next = () => { if (!isLast) setStep(s => s + 1); else onClose(); };
  const prev = () => { if (!isFirst) setStep(s => s - 1); };
  const skip = () => onClose();

  /* ── Tooltip placement for slide mode ── */
  // When the highlight is a slider at the bottom of the frame, push the tooltip to the top.
  const slideTooltipAtTop = isSlide && ["fondu", "zoom"].includes(current.frame?.highlight);
  const slideTooltipStyle = isSlide
    ? (() => {
        const w = isMobile ? vpSize.w - 24 : 440;
        return {
          position: "fixed",
          left: Math.max(12, (vpSize.w - w) / 2),
          width: w,
          // Sur smartphone la bulle ne doit pas manger l'illustration qu'elle
          // commente : on la borne à un peu plus d'un tiers de l'écran.
          maxHeight: isMobile ? Math.round(vpSize.h * 0.42) : vpSize.h - 56,
          ...(slideTooltipAtTop ? { top: 28 } : { bottom: 28 }),
        };
      })()
    : null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "auto" }}
    >
      {/* ── Dark backdrop (spotlight mask for spotlight steps, solid for the rest) ── */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}
        viewBox={`0 0 ${vpSize.w} ${vpSize.h}`}
        preserveAspectRatio="none"
      >
        <defs>
          <mask id="tutorial-mask">
            <rect x="0" y="0" width={vpSize.w} height={vpSize.h} fill="white" />
            {hasTarget && spotlightRect && (
              <rect
                x={spotlightRect.x} y={spotlightRect.y}
                width={spotlightRect.w} height={spotlightRect.h}
                rx="6" ry="6" fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0" y="0" width={vpSize.w} height={vpSize.h}
          fill={isSlide ? "rgba(8,8,8,0.97)" : "rgba(0,0,0,0.82)"}
          mask={hasTarget ? "url(#tutorial-mask)" : undefined}
        />
      </svg>

      {/* ── Slide frame (mock lightbox UI + photo + pulse halo on real refs) ── */}
      {isSlide && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2 }}>
          <SlideFrame
            key={step} /* remount on step change so refs and halo re-measure */
            frame={current.frame}
            image={current.image}
            isMobile={isMobile}
          />
        </div>
      )}

      {/* ── Spotlight glow border (spotlight mode only) ── */}
      {hasTarget && spotlightRect && (
        <div style={{
          position: "fixed",
          left: spotlightRect.x, top: spotlightRect.y,
          width: spotlightRect.w, height: spotlightRect.h,
          borderRadius: 6,
          border: "2px solid rgba(242,101,34,0.5)",
          boxShadow: "0 0 20px rgba(242,101,34,0.15), inset 0 0 20px rgba(242,101,34,0.05)",
          pointerEvents: "none",
          transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
          zIndex: 3,
        }} />
      )}

      {/* ── Clickable backdrop (advance on click) ── */}
      <div onClick={next} style={{ position: "fixed", inset: 0, cursor: "pointer", zIndex: 5 }} />

      {/* ── Top progress bar (always visible) ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 3,
        background: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)", zIndex: 10002, pointerEvents: "none",
      }}>
        <div style={{
          height: "100%",
          width: `${((step + 1) / STEPS.length) * 100}%`,
          background: "linear-gradient(90deg, #f26522, #ff8a4d)",
          boxShadow: "0 0 12px rgba(242,101,34,0.5)",
          transition: "width 0.4s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>

      {/* ── Tooltip / step card ── */}
      <div
        ref={tooltipRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...(isSlide
            ? slideTooltipStyle
            : hasTarget
            ? tooltipStyle
            : {
                position: "fixed",
                top: "50%", left: "50%",
                transform: "translate(-50%, -50%)",
                width: isMobile ? window.innerWidth - 32 : 420,
                maxHeight: vpSize.h - 32,
              }),
          background: isLight ? "rgba(255,255,255,0.97)" : "rgba(20,20,20,0.96)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid var(--c-2a2a2a)",
          borderRadius: 8,
          boxShadow: isLight ? "0 16px 60px rgba(0,0,0,0.22)" : "0 16px 60px rgba(0,0,0,0.8)",
          fontFamily: "var(--font-apple)",
          overflow: "hidden",
          // Colonne : en-tête et pied restent visibles, seul le texte défile
          // quand `maxHeight` borne la bulle.
          display: "flex",
          flexDirection: "column",
          opacity: animating ? 0 : 1,
          transition: "opacity 0.25s ease, top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1), bottom 0.35s cubic-bezier(0.4,0,0.2,1)",
          zIndex: 10001,
        }}
      >
        {/* Header */}
        <div ref={headerRef} style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--c-1c1c1c)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: "rgba(242,101,34,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 17, color: "#f26522",
            }}>
              {current.icon}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-ddd5c8)", letterSpacing: 1 }}>
              {current.title}
            </div>
          </div>
          <button onClick={skip} style={{
            background: "transparent", border: "none", color: "var(--c-ddd)",
            cursor: "pointer", fontSize: 17, padding: "2px 6px", lineHeight: 1,
          }} title="Fermer">
            ✕
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ padding: "14px 20px 16px", overflowY: "auto", minHeight: 0, flex: "1 1 auto" }}>
          <p style={{
            fontSize: 14, color: "var(--c-ddd)", lineHeight: 1.7,
            margin: 0, fontFamily: "var(--font-apple)",
          }}>
            {current.body}
          </p>
        </div>

        {/* Footer: dots + buttons */}
        <div ref={footerRef} style={{
          padding: "10px 20px 14px",
          borderTop: "1px solid var(--c-1c1c1c)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0, flexWrap: "wrap", gap: 8,
        }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 14 : 5, height: 5, borderRadius: 3,
                background: i <= step ? "#f26522" : "var(--c-2a2a2a)",
                opacity: i < step ? 0.4 : 1,
                transition: "all 0.3s ease",
              }} />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isFirst && (
              <button onClick={prev} style={{
                background: "transparent", border: "1px solid var(--c-2a2a2a)",
                color: "var(--c-ddd)", padding: "6px 14px", cursor: "pointer",
                fontFamily: "var(--font-apple)",
                fontSize: 11, letterSpacing: 1, textTransform: "uppercase", borderRadius: 3,
              }}>Précédent</button>
            )}
            {isFirst && (
              <button onClick={skip} style={{
                background: "transparent", border: "none", color: "var(--c-ddd)",
                padding: "6px 10px", cursor: "pointer",
                fontFamily: "var(--font-apple)",
                fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
              }}>Passer</button>
            )}
            <button onClick={next} style={{
              background: "#f26522", border: "none", color: "#090909",
              padding: "7px 18px", cursor: "pointer",
              fontFamily: "var(--font-apple)",
              fontSize: 11, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", borderRadius: 3,
            }}>
              {isLast ? "Commencer" : "Suivant"}
            </button>
          </div>
        </div>

        {/* Step counter */}
        <div style={{
          position: "absolute", top: 18, right: 44,
          fontSize: 10, color: "var(--c-ddd)",
          fontFamily: "var(--font-apple)", letterSpacing: 1,
        }}>
          {step + 1}/{STEPS.length}
        </div>
      </div>

      {/* ── Inline keyframes for pulse animations ── */}
      <style>{`
        @keyframes ac-tut-pulse-border {
          0%, 100% { opacity: 0.85; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(1.04); }
        }
        @keyframes ac-tut-pulse-ring {
          0%   { box-shadow: 0 0 0 0    rgba(242,101,34,0.55); }
          70%  { box-shadow: 0 0 0 24px rgba(242,101,34,0);    }
          100% { box-shadow: 0 0 0 0    rgba(242,101,34,0);    }
        }
        .ac-tut-pulse    { animation: ac-tut-pulse-border 1.8s ease-in-out infinite; transform-origin: center; }
        .ac-tut-pulse-bg { animation: ac-tut-pulse-ring   1.8s ease-out      infinite; }
      `}</style>
    </div>
  );
}
