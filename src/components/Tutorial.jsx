import { useState, useEffect, useCallback, useRef } from "react";

const STEPS = [
  {
    target: null,
    title: "Bienvenue sur AutoCache",
    body: "Ce didacticiel vous guide a travers les principales fonctions de l'application. En quelques clics, vous pourrez apposer votre cache plaque, ameliorer vos photos et generer des visuels showroom professionnels.",
    icon: "⬡",
  },
  {
    target: "logo",
    title: "01 — Cache plaque",
    body: "Importez votre logo (PNG avec transparence) ou generez-le directement en choisissant texte, police et couleurs. Ce visuel sera automatiquement applique sur les plaques d'immatriculation detectees.",
    icon: "⬡",
  },
  {
    target: "photos",
    title: "02 — Photos de vehicules",
    body: "Glissez vos photos de vehicules ici ou cliquez pour les selectionner. Vous pouvez traiter plusieurs photos en une seule fois — l'IA detecte automatiquement les plaques sur chaque image.",
    icon: "◈",
  },
  {
    target: "enhancements",
    title: "Ameliorations automatiques",
    body: "Activez les options d'amelioration : correction des couleurs, lustrage des optiques, lustrage carrosserie... Chaque option est independante et s'applique lors du traitement.",
    icon: "✨",
  },
  {
    target: "showroom",
    title: "03 — Showroom Virtuel",
    body: "Activez le mode Showroom pour detourer automatiquement le vehicule et le placer sur un fond de scene professionnel. Choisissez parmi les fonds proposes ou importez le votre.",
    icon: "⬡",
  },
  {
    target: "process",
    title: "Lancer le traitement",
    body: "Une fois votre logo charge et vos photos ajoutees, cliquez ici pour lancer le traitement. L'IA analyse chaque photo, detecte les plaques et applique vos reglages.",
    icon: "▶",
  },
  {
    target: "results-tab",
    title: "Resultats",
    body: "Retrouvez toutes vos photos traitees dans l'onglet Resultats. Vous pourrez les telecharger individuellement ou toutes en une seule fois.",
    icon: "◈",
  },
  {
    target: "credits",
    title: "Suivi des credits",
    body: "Votre compteur de credits est affiche ici. Cliquez dessus pour voir les details de votre abonnement et la date de renouvellement.",
    icon: "◎",
  },
  {
    target: null,
    title: "Vous etes pret !",
    body: "Vous connaissez maintenant les fonctions essentielles d'AutoCache. Vous pouvez revoir ce didacticiel a tout moment depuis le menu Parametres en haut a droite. Bonne utilisation !",
    icon: "✓",
  },
];

/* ── Compute best tooltip placement around the spotlight ── */
function computeTooltipPlacement(sr, tooltipW, isMobile) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const GAP = 14;
  const TOOLTIP_H_EST = 200; // estimated height for collision checks

  // Available space on each side
  const spaceRight = vw - (sr.x + sr.w + GAP);
  const spaceLeft  = sr.x - GAP;
  const spaceBelow = vh - (sr.y + sr.h + GAP);
  const spaceAbove = sr.y - GAP;

  let top, left;

  if (!isMobile && spaceRight >= tooltipW) {
    // Place to the right
    left = sr.x + sr.w + GAP;
    top  = Math.max(GAP, Math.min(sr.y, vh - TOOLTIP_H_EST - GAP));
  } else if (!isMobile && spaceLeft >= tooltipW) {
    // Place to the left
    left = sr.x - tooltipW - GAP;
    top  = Math.max(GAP, Math.min(sr.y, vh - TOOLTIP_H_EST - GAP));
  } else if (spaceBelow >= TOOLTIP_H_EST) {
    // Place below
    left = Math.max(GAP, Math.min(sr.x + sr.w / 2 - tooltipW / 2, vw - tooltipW - GAP));
    top  = sr.y + sr.h + GAP;
  } else if (spaceAbove >= TOOLTIP_H_EST) {
    // Place above
    left = Math.max(GAP, Math.min(sr.x + sr.w / 2 - tooltipW / 2, vw - tooltipW - GAP));
    top  = sr.y - TOOLTIP_H_EST - GAP;
  } else {
    // Fallback: center bottom area
    left = Math.max(GAP, (vw - tooltipW) / 2);
    top  = vh - TOOLTIP_H_EST - 30;
  }

  return { position: "fixed", top, left, width: tooltipW };
}

export default function Tutorial({ onClose, isMobile }) {
  const [step, setStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [animating, setAnimating] = useState(true);
  const [vpSize, setVpSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const tooltipRef = useRef(null);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;
  const hasTarget = !!current.target;

  // ── Measure target element position ──
  const measureTarget = useCallback(() => {
    setVpSize({ w: window.innerWidth, h: window.innerHeight });

    if (!current.target) {
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
  }, [current.target, isMobile]);

  // ── Scroll target into view + measure ──
  useEffect(() => {
    if (!current.target) {
      measureTarget();
      return;
    }
    const el = document.querySelector(`[data-tutorial="${current.target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Re-measure after scroll settles
      const t1 = setTimeout(measureTarget, 100);
      const t2 = setTimeout(measureTarget, 450);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else {
      measureTarget();
    }
  }, [step, current.target, measureTarget]);

  // ── Resize + scroll listeners ──
  useEffect(() => {
    const h = () => measureTarget();
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    return () => {
      window.removeEventListener("resize", h);
      window.removeEventListener("scroll", h, true);
    };
  }, [measureTarget]);

  // ── Entry animation ──
  useEffect(() => {
    setAnimating(true);
    const t = setTimeout(() => setAnimating(false), 80);
    return () => clearTimeout(t);
  }, [step]);

  // ── ESC to close ──
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // ── Keyboard nav (arrow keys) ──
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

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "auto" }}
    >
      {/* ── Dark overlay with spotlight cutout via SVG mask ── */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        viewBox={`0 0 ${vpSize.w} ${vpSize.h}`}
        preserveAspectRatio="none"
      >
        <defs>
          <mask id="tutorial-mask">
            <rect x="0" y="0" width={vpSize.w} height={vpSize.h} fill="white" />
            {spotlightRect && (
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
          fill="rgba(0,0,0,0.82)" mask="url(#tutorial-mask)"
        />
      </svg>

      {/* ── Spotlight glow border ── */}
      {spotlightRect && (
        <div style={{
          position: "fixed",
          left: spotlightRect.x, top: spotlightRect.y,
          width: spotlightRect.w, height: spotlightRect.h,
          borderRadius: 6,
          border: "2px solid rgba(242,101,34,0.5)",
          boxShadow: "0 0 20px rgba(242,101,34,0.15), inset 0 0 20px rgba(242,101,34,0.05)",
          pointerEvents: "none",
          transition: "all 0.35s cubic-bezier(0.4,0,0.2,1)",
        }} />
      )}

      {/* ── Clickable backdrop (advance on click) ── */}
      <div onClick={next} style={{ position: "fixed", inset: 0, cursor: "pointer" }} />

      {/* ── Tooltip card ── */}
      <div
        ref={tooltipRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...(hasTarget ? tooltipStyle : {
            position: "fixed",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: isMobile ? Math.min(360, window.innerWidth - 32) : 420,
          }),
          background: "#141414",
          border: "1px solid #2a2a2a",
          borderRadius: 8,
          boxShadow: "0 16px 60px rgba(0,0,0,0.8)",
          fontFamily: "'Rajdhani', sans-serif",
          overflow: "hidden",
          opacity: animating ? 0 : 1,
          transition: "opacity 0.25s ease, top 0.35s cubic-bezier(0.4,0,0.2,1), left 0.35s cubic-bezier(0.4,0,0.2,1)",
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
          {/* Step dots */}
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 16 : 6, height: 6, borderRadius: 3,
                background: i <= step ? "#f26522" : "#2a2a2a",
                opacity: i < step ? 0.4 : 1,
                transition: "all 0.3s ease",
              }} />
            ))}
          </div>

          {/* Buttons */}
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
    </div>
  );
}
