import { useState, useEffect, useCallback, useRef } from "react";

const TUTORIAL_BASE = "/tutorial";

/*
 * STEPS — drives the whole tutorial.
 *
 *   mode: "card"      → centred dialog, no spotlight (intro / outro)
 *   mode: "spotlight" → cuts a hole in the dark overlay over `target` and points a tooltip at it
 *   mode: "slide"     → full-screen image walkthrough with optional pulse halo on a sub-region
 *
 * `highlight` for slide mode is expressed as percentages of the source image
 * (xPct/yPct/wPct/hPct) so it tracks the natural geometry, not the displayed size.
 */
const STEPS = [
  // ── Welcome ─────────────────────────────────────────────────────────────
  {
    mode: "card",
    title: "Bienvenue sur AutoCache",
    body: "Ce didacticiel vous guide à travers les principales fonctions de l'application. En quelques clics, vous pourrez apposer votre cache plaque, améliorer vos photos et générer des visuels showroom professionnels.",
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
    body: "Activez les options d'amélioration : correction des couleurs, lustrage des optiques, lustrage carrosserie... Chaque option est indépendante et s'applique lors du traitement.",
    icon: "✨",
  },
  {
    mode: "spotlight",
    target: "showroom",
    title: "03 — Showroom Virtuel",
    body: "Activez le mode Showroom pour détourer automatiquement le véhicule et le placer sur un fond de scène professionnel. Choisissez parmi les fonds proposés ou importez le vôtre.",
    icon: "⬡",
  },
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
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/2-cache-auto.jpg`,
    title: "Étape 2 — Cache plaque posé",
    body: "L'IA détecte la plaque et applique automatiquement votre cache plaque. La plupart du temps, le résultat est immédiatement parfait.",
    icon: "⬡",
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/3-cache-ajust.jpg`,
    title: "Étape 3 — Ajuster les coins",
    body: "Si le placement n'est pas parfait, cliquez sur AJUSTER : vous pouvez alors glisser les 4 coins orange pour repositionner le cache au pixel près. Le résultat s'applique en temps réel.",
    icon: "⊞",
    highlight: { xPct: 73.7, yPct: 6.9, wPct: 9.7, hPct: 5.7, label: "AJUSTER" },
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/4-cache-ok.jpg`,
    title: "Étape 4 — Cache plaque validé",
    body: "Voilà le rendu après ajustement, propre et précis. À ce stade, vous pouvez télécharger la photo telle quelle, ou passer en mode showroom pour aller plus loin.",
    icon: "✓",
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/5-showroom-base.jpg`,
    title: "Étape 5 — Décor Showroom",
    body: "Activez un décor showroom pour mettre la voiture en valeur : Garage, Luxury, Classique... plusieurs ambiances disponibles, choisissez celle qui correspond à votre identité.",
    icon: "◇",
  },
  {
    mode: "slide",
    image: `${TUTORIAL_BASE}/6-showroom-ajust-ok.jpg`,
    title: "Étape 6 — Fondu showroom",
    body: "Glissez le slider FONDU pour intégrer parfaitement la voiture au décor : l'éclairage du sol se reflète sur la carrosserie, les couleurs se marient. Téléchargez votre visuel showroom final.",
    icon: "✦",
    highlight: { xPct: 31, yPct: 84.5, wPct: 36, hPct: 4, label: "FONDU" },
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

/* ── Best tooltip placement around a spotlight rect ── */
function computeTooltipPlacement(sr, tooltipW, isMobile) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const GAP = 14;
  const TOOLTIP_H_EST = 200;

  const spaceRight = vw - (sr.x + sr.w + GAP);
  const spaceLeft  = sr.x - GAP;
  const spaceBelow = vh - (sr.y + sr.h + GAP);
  const spaceAbove = sr.y - GAP;

  let top, left;
  if (!isMobile && spaceRight >= tooltipW) {
    left = sr.x + sr.w + GAP;
    top  = Math.max(GAP, Math.min(sr.y, vh - TOOLTIP_H_EST - GAP));
  } else if (!isMobile && spaceLeft >= tooltipW) {
    left = sr.x - tooltipW - GAP;
    top  = Math.max(GAP, Math.min(sr.y, vh - TOOLTIP_H_EST - GAP));
  } else if (spaceBelow >= TOOLTIP_H_EST) {
    left = Math.max(GAP, Math.min(sr.x + sr.w / 2 - tooltipW / 2, vw - tooltipW - GAP));
    top  = sr.y + sr.h + GAP;
  } else if (spaceAbove >= TOOLTIP_H_EST) {
    left = Math.max(GAP, Math.min(sr.x + sr.w / 2 - tooltipW / 2, vw - tooltipW - GAP));
    top  = sr.y - TOOLTIP_H_EST - GAP;
  } else {
    left = Math.max(GAP, (vw - tooltipW) / 2);
    top  = vh - TOOLTIP_H_EST - 30;
  }
  return { position: "fixed", top, left, width: tooltipW };
}

/* ── Compute the actual rendered rect of an <img> using object-fit: contain ── */
function getContainedImageRect(imgEl) {
  const cr = imgEl.getBoundingClientRect();
  const iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
  if (!iw || !ih) return { left: cr.left, top: cr.top, width: cr.width, height: cr.height };
  const containerRatio = cr.width / cr.height;
  const imgRatio = iw / ih;
  let dw, dh;
  if (imgRatio > containerRatio) { dw = cr.width; dh = cr.width / imgRatio; }
  else                           { dh = cr.height; dw = cr.height * imgRatio; }
  return {
    left: cr.left + (cr.width - dw) / 2,
    top:  cr.top  + (cr.height - dh) / 2,
    width: dw, height: dh,
  };
}

export default function Tutorial({ onClose, isMobile }) {
  const [step, setStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [animating, setAnimating] = useState(true);
  const [vpSize, setVpSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [haloRect, setHaloRect] = useState(null);
  const tooltipRef = useRef(null);
  const slideImgRefs = useRef({});

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

    const tooltipW = isMobile ? Math.min(320, window.innerWidth - 24) : 360;
    setTooltipStyle(computeTooltipPlacement(sr, tooltipW, isMobile));
  }, [current.target, hasTarget, isMobile]);

  /* ── Measure the halo position over the displayed slide image ── */
  const measureHalo = useCallback(() => {
    setVpSize({ w: window.innerWidth, h: window.innerHeight });
    if (!isSlide || !current.highlight) {
      setHaloRect(null);
      return;
    }
    const img = slideImgRefs.current[step];
    if (!img || !img.naturalWidth) {
      // image not yet loaded — try again shortly
      setHaloRect(null);
      return;
    }
    const r = getContainedImageRect(img);
    const { xPct, yPct, wPct, hPct } = current.highlight;
    setHaloRect({
      left:   r.left   + (xPct / 100) * r.width,
      top:    r.top    + (yPct / 100) * r.height,
      width:  (wPct / 100) * r.width,
      height: (hPct / 100) * r.height,
    });
  }, [isSlide, current.highlight, step]);

  /* ── Scroll target into view + measure (spotlight) / measure halo (slide) ── */
  useEffect(() => {
    if (isSlide) {
      // give the image a moment to render after step change
      const t1 = setTimeout(measureHalo, 60);
      const t2 = setTimeout(measureHalo, 350);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (!hasTarget) {
      measureTarget();
      return;
    }
    const el = document.querySelector(`[data-tutorial="${current.target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const t1 = setTimeout(measureTarget, 100);
      const t2 = setTimeout(measureTarget, 450);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else {
      measureTarget();
    }
  }, [step, current.target, hasTarget, isSlide, measureTarget, measureHalo]);

  /* ── Resize / scroll listeners ── */
  useEffect(() => {
    const h = () => { measureTarget(); measureHalo(); };
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    return () => {
      window.removeEventListener("resize", h);
      window.removeEventListener("scroll", h, true);
    };
  }, [measureTarget, measureHalo]);

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
  // When the highlight sits in the lower half, place the tooltip at the top; otherwise bottom.
  const slideTooltipAtTop = isSlide && current.highlight && current.highlight.yPct > 50;
  const slideTooltipStyle = isSlide
    ? (() => {
        const w = isMobile ? Math.min(380, window.innerWidth - 24) : 440;
        return {
          position: "fixed",
          left: Math.max(12, (vpSize.w - w) / 2),
          width: w,
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

      {/* ── Slide image stack (cross-faded, drawn ABOVE the dark backdrop) ── */}
      {STEPS.map((s, i) => {
        if (s.mode !== "slide") return null;
        const visible = i === step;
        return (
          <img
            key={i}
            ref={(el) => { if (el) slideImgRefs.current[i] = el; }}
            src={s.image}
            alt=""
            onLoad={visible ? measureHalo : undefined}
            style={{
              position: "fixed",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: isMobile ? 12 : "60px 32px 140px",
              boxSizing: "border-box",
              opacity: visible ? 1 : 0,
              transition: "opacity 0.45s ease-in-out",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
        );
      })}

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

      {/* ── Pulse halo on slide highlight (above the image) ── */}
      {isSlide && haloRect && (
        <>
          <div className="ac-tut-pulse" style={{
            position: "fixed",
            left: haloRect.left - 6,
            top:  haloRect.top - 6,
            width:  haloRect.width + 12,
            height: haloRect.height + 12,
            borderRadius: 8,
            border: "2px solid rgba(242,101,34,0.85)",
            pointerEvents: "none",
            zIndex: 4,
          }} />
          <div className="ac-tut-pulse-bg" style={{
            position: "fixed",
            left: haloRect.left - 6,
            top:  haloRect.top - 6,
            width:  haloRect.width + 12,
            height: haloRect.height + 12,
            borderRadius: 8,
            background: "rgba(242,101,34,0.0)",
            boxShadow: "0 0 0 0 rgba(242,101,34,0.45)",
            pointerEvents: "none",
            zIndex: 4,
          }} />
        </>
      )}

      {/* ── Clickable backdrop (advance on click) ── */}
      <div onClick={next} style={{ position: "fixed", inset: 0, cursor: "pointer", zIndex: 5 }} />

      {/* ── Top progress bar (always visible) ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 3,
        background: "rgba(255,255,255,0.06)", zIndex: 10002, pointerEvents: "none",
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
                width: isMobile ? Math.min(360, window.innerWidth - 32) : 420,
              }),
          background: "rgba(20,20,20,0.96)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid #2a2a2a",
          borderRadius: 8,
          boxShadow: "0 16px 60px rgba(0,0,0,0.8)",
          fontFamily: "'Rajdhani', sans-serif",
          overflow: "hidden",
          opacity: animating ? 0 : 1,
          transition: "opacity 0.25s ease, top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1), bottom 0.35s cubic-bezier(0.4,0,0.2,1)",
          zIndex: 10001,
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid #1c1c1c",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: "rgba(242,101,34,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, color: "#f26522",
            }}>
              {current.icon}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#ddd5c8", letterSpacing: 1 }}>
              {current.title}
            </div>
          </div>
          <button onClick={skip} style={{
            background: "transparent", border: "none", color: "#555",
            cursor: "pointer", fontSize: 16, padding: "2px 6px", lineHeight: 1,
          }} title="Fermer">
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 20px 16px" }}>
          <p style={{
            fontSize: 13, color: "#999", lineHeight: 1.7,
            margin: 0, fontFamily: "'Rajdhani', sans-serif",
          }}>
            {current.body}
          </p>
        </div>

        {/* Footer: dots + buttons */}
        <div style={{
          padding: "10px 20px 14px",
          borderTop: "1px solid #1c1c1c",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 14 : 5, height: 5, borderRadius: 3,
                background: i <= step ? "#f26522" : "#2a2a2a",
                opacity: i < step ? 0.4 : 1,
                transition: "all 0.3s ease",
              }} />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {!isFirst && (
              <button onClick={prev} style={{
                background: "transparent", border: "1px solid #2a2a2a",
                color: "#888", padding: "6px 14px", cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10, letterSpacing: 1, textTransform: "uppercase", borderRadius: 3,
              }}>Retour</button>
            )}
            {isFirst && (
              <button onClick={skip} style={{
                background: "transparent", border: "none", color: "#555",
                padding: "6px 10px", cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
              }}>Passer</button>
            )}
            <button onClick={next} style={{
              background: "#f26522", border: "none", color: "#090909",
              padding: "7px 18px", cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, fontWeight: 700, letterSpacing: 1,
              textTransform: "uppercase", borderRadius: 3,
            }}>
              {isLast ? "Commencer" : "Suivant"}
            </button>
          </div>
        </div>

        {/* Step counter */}
        <div style={{
          position: "absolute", top: 18, right: 44,
          fontSize: 9, color: "#444",
          fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
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
