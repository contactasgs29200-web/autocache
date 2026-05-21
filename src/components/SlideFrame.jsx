import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

/*
 * SlideFrame
 * ──────────
 * Renders a tutorial slide as a faithful mock of the real lightbox so the
 * pulse halo can target actual React refs (pixel-perfect) instead of guessing
 * coordinates from a JPEG screenshot.
 *
 *   frame: {
 *     filename: "renault-scenic.jpg",               // displayed on the left of the title bar
 *     buttons: [{ id, label, variant }],            // header buttons (ordered)
 *     closeButton: true,                            // ✕ on the far right
 *     centerButton: { icon: "▼" },                  // optional orange round button at the centre top
 *     sliders: [{ id, icon, label, percent, value }] // optional bottom sliders
 *     footer: "Glisser un point orange…"            // optional small footer text
 *     highlight: "ajuster" | "fondu" | null         // id of the element to surround with a pulse halo
 *   }
 *
 * Button variants:
 *   - "inactive"     : dark grey / pale text
 *   - "yellow-active": filled yellow with dark text (mode currently on)
 *   - "yellow-idle"  : dark with yellow text + thin yellow border
 *   - "orange"       : filled orange (primary action like Télécharger)
 */
const BTN_VARIANTS = {
  "inactive":      { bg: "#181818", color: "#ddd",     border: "1px solid #2a2a2a" },
  "yellow-active": { bg: "#e8a020", color: "#090909", border: "1px solid #e8a020" },
  "yellow-idle":   { bg: "#181818", color: "#e8a020", border: "1px solid #3a2800" },
  "orange":        { bg: "#f26522", color: "#090909", border: "none" },
};

const SlideFrame = forwardRef(function SlideFrame({ frame, image, isMobile = false }, ref) {
  const containerRef = useRef(null);
  const targetRefs   = useRef({}); // id -> DOM node
  const [haloRect, setHaloRect] = useState(null);

  /* Recompute halo rect when the layout settles or on resize */
  const measureHalo = () => {
    if (!frame?.highlight) { setHaloRect(null); return; }
    const el = targetRefs.current[frame.highlight];
    if (!el) { setHaloRect(null); return; }
    const r = el.getBoundingClientRect();
    setHaloRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  };

  useEffect(() => {
    // Mesure une fois mounté + une fois après transitions de layout
    const t1 = setTimeout(measureHalo, 30);
    const t2 = setTimeout(measureHalo, 250);
    const t3 = setTimeout(measureHalo, 600);
    const onResize = () => measureHalo();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.highlight, image]);

  useImperativeHandle(ref, () => ({
    /* Allow parent to force a re-measure (e.g. after the slide cross-fades in) */
    remeasureHalo: measureHalo,
  }), [frame?.highlight]);

  if (!frame) {
    // Sans frame, simple <img>
    return (
      <img src={image} alt="" style={{
        position: "fixed", inset: 0, width: "100%", height: "100%",
        objectFit: "contain", padding: isMobile ? 12 : "60px 32px 140px",
        boxSizing: "border-box", pointerEvents: "none",
      }} />
    );
  }

  const { filename, buttons = [], closeButton = false, centerButton, sliders, footer, highlight } = frame;

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: "fixed",
          inset: 0,
          padding: isMobile ? "16px 8px 80px" : "48px 24px 80px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: isMobile ? 6 : 8,
          fontFamily: "'Rajdhani', sans-serif",
          pointerEvents: "none", // halo + clickable backdrop handled at Tutorial level
        }}
      >
        {/* ── Mock title bar ─────────────────────────────────────────── */}
        <div style={{
          width: "100%", maxWidth: 1100,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, padding: "0 2px",
          position: "relative",
        }}>
          {/* Filename on the left */}
          {!isMobile && (
            <div style={{
              fontSize: 11, color: "#ddd",
              fontFamily: "'JetBrains Mono', monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: "30%",
            }}>{filename ?? ""}</div>
          )}

          {/* Optional orange centre button */}
          {centerButton && !isMobile && (
            <div style={{
              position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
              width: 36, height: 36, borderRadius: "50%",
              background: "#f26522",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 15,
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}>
              {centerButton.icon ?? "▼"}
            </div>
          )}

          {/* Buttons on the right */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
            {buttons.map(({ id, label, variant }) => {
              const v = BTN_VARIANTS[variant] ?? BTN_VARIANTS["inactive"];
              return (
                <div
                  key={id}
                  ref={(el) => { if (el) targetRefs.current[id] = el; }}
                  style={{
                    background: v.bg, color: v.color, border: v.border,
                    padding: isMobile ? "6px 10px" : "7px 14px",
                    fontFamily: "'Rajdhani', sans-serif",
                    fontSize: isMobile ? 11 : 12,
                    fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                    borderRadius: 2, lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >{label}</div>
              );
            })}

            {closeButton && (
              <div style={{
                width: 28, height: 28, borderRadius: 2,
                background: "rgba(20,20,20,0.92)", border: "1px solid #3a3a3a",
                color: "#ddd", fontSize: 15,
                display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}>✕</div>
            )}
          </div>
        </div>

        {/* ── Photo (object-fit contain, flex-grow) ──────────────────── */}
        <div style={{
          flex: 1, width: "100%",
          minHeight: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative",
        }}>
          <img
            src={image}
            alt=""
            onLoad={measureHalo}
            style={{
              maxWidth: "min(1100px, 100%)",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 2,
            }}
          />

          {/* ── Mock nudge arrows (showroom mode) ───────────────────── */}
          {frame.nudgeArrows && [
            { dir: "up",    label: "▲", style: { top:    isMobile ? 8 : 18,  left:  "50%", transform: "translateX(-50%)" } },
            { dir: "down",  label: "▼", style: { bottom: isMobile ? 8 : 18,  left:  "50%", transform: "translateX(-50%)" } },
            { dir: "left",  label: "◀", style: { left:   isMobile ? 8 : 18,  top:   "50%", transform: "translateY(-50%)" } },
            { dir: "right", label: "▶", style: { right:  isMobile ? 8 : 18,  top:   "50%", transform: "translateY(-50%)" } },
          ].map(({ dir, label, style }) => (
            <div
              key={dir}
              style={{
                position: "absolute",
                ...style,
                width:  isMobile ? 42 : 48,
                height: isMobile ? 42 : 48,
                borderRadius: "50%",
                background: "rgba(242,101,34,0.82)",
                border: "2px solid rgba(255,255,255,0.18)",
                color: "#fff",
                fontSize: isMobile ? 17 : 19,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 12px rgba(0,0,0,0.7)",
                lineHeight: 1,
              }}
            >{label}</div>
          ))}
        </div>

        {/* ── Mock sliders (optional) ────────────────────────────────── */}
        {sliders && sliders.map(({ id, icon, label, percent, value }) => (
          <div
            key={id}
            ref={(el) => { if (el) targetRefs.current[id] = el; }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "min(500px, 90vw)",
              padding: "4px 0",
            }}
          >
            <span style={{ fontSize: 17, userSelect: "none" }}>{icon}</span>
            <span style={{
              fontSize: 11, color: "#ddd",
              letterSpacing: 1.5, textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
              userSelect: "none", whiteSpace: "nowrap",
            }}>{label}</span>
            <div style={{ flex: 1, position: "relative", height: 14, display: "flex", alignItems: "center" }}>
              {/* track */}
              <div style={{ width: "100%", height: 2, background: "#252525", borderRadius: 1 }} />
              {/* thumb */}
              <div style={{
                position: "absolute", left: `${percent}%`,
                width: 13, height: 13, borderRadius: "50%",
                background: "#f26522",
                transform: "translate(-50%, 0)",
              }} />
            </div>
            <span style={{
              fontSize: 11, color: "#f26522",
              fontFamily: "'JetBrains Mono', monospace",
              minWidth: 34, textAlign: "right",
            }}>{value}</span>
          </div>
        ))}

        {/* ── Footer text (optional) ─────────────────────────────────── */}
        {footer && (
          <div style={{
            marginTop: 4,
            fontSize: 10, color: "#ddd",
            fontFamily: "'JetBrains Mono', monospace",
            textAlign: "center",
            maxWidth: "min(900px, 95%)",
          }}>{footer}</div>
        )}
      </div>

      {/* ── Pulse halo positioned via measured ref rect ─────────────── */}
      {haloRect && (
        <>
          <div className="ac-tut-pulse" style={{
            position: "fixed",
            left:   haloRect.left   - 6,
            top:    haloRect.top    - 6,
            width:  haloRect.width  + 12,
            height: haloRect.height + 12,
            borderRadius: 6,
            border: "2px solid rgba(242,101,34,0.85)",
            pointerEvents: "none",
            zIndex: 4,
          }} />
          <div className="ac-tut-pulse-bg" style={{
            position: "fixed",
            left:   haloRect.left   - 6,
            top:    haloRect.top    - 6,
            width:  haloRect.width  + 12,
            height: haloRect.height + 12,
            borderRadius: 6,
            pointerEvents: "none",
            zIndex: 4,
          }} />
        </>
      )}
    </>
  );
});

export default SlideFrame;
