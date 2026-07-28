import React, { useCallback, useEffect, useRef, useState } from "react";
import { frameIndexFromDrag, isSpinUsable } from "../showroomInteractif.js";

// =============================================================================
//  Visualiseur 360° — l'acheteur fait pivoter le véhicule au doigt.
//
//  `frames` : tableau ordonné de sources d'images (URL blob ou data URL), une
//  par vue, dans le sens de la marche autour du véhicule.
//
//  Rendu purement local : les images sont déjà en mémoire, aucune requête.
// =============================================================================

const ACCENT = "#f26522";

export default function Spin360({ frames = [], height = 320, onClose, title = "Tour 360°" }) {
  const count = frames.length;
  const boxRef = useRef(null);
  const dragRef = useRef(null);     // { startX, startIndex }
  const [index, setIndex] = useState(0);
  const [hasDragged, setHasDragged] = useState(false);
  const [loaded, setLoaded] = useState(0);

  // Signature stable du lot de vues. `frames` est souvent construit en ligne
  // par l'appelant (`results.map(...)`), donc son identité change à chaque
  // rendu : s'en servir comme dépendance d'effet relancerait le préchargement
  // en boucle. On compare donc un condensé du contenu, pas la référence.
  const framesKey = `${count}|${(frames[0] || "").slice(0, 64)}|${(frames[count - 1] || "").slice(0, 64)}`;

  // Précharge : sans ça, la première rotation affiche des trous blancs le temps
  // que chaque vue se décode.
  useEffect(() => {
    let alive = true;
    setLoaded(0);
    frames.forEach(src => {
      const img = new Image();
      img.onload = img.onerror = () => { if (alive) setLoaded(n => n + 1); };
      img.src = src;
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesKey]);

  // Un lot plus court ne doit pas laisser l'index pointer dans le vide.
  useEffect(() => { setIndex(i => (count ? Math.min(i, count - 1) : 0)); }, [count]);

  const beginDrag = useCallback((clientX) => {
    dragRef.current = { startX: clientX, startIndex: index };
  }, [index]);

  const moveDrag = useCallback((clientX) => {
    const d = dragRef.current;
    const box = boxRef.current;
    if (!d || !box || !count) return;
    const dx = clientX - d.startX;
    if (Math.abs(dx) > 4) setHasDragged(true);
    setIndex(frameIndexFromDrag(d.startIndex, dx, box.clientWidth, count));
  }, [count]);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  // Souris + tactile. On écoute le déplacement sur window pour ne pas perdre le
  // geste quand le doigt sort du cadre.
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      moveDrag(x);
      if (e.cancelable) e.preventDefault();   // bloque le scroll pendant la rotation
    };
    const onUp = () => endDrag();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [moveDrag, endDrag]);

  const step = useCallback((dir) => {
    if (!count) return;
    setHasDragged(true);
    setIndex(i => ((i + dir) % count + count) % count);
  }, [count]);

  if (!isSpinUsable(count)) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--c-ddd)", fontFamily: "var(--font-apple)", fontSize: 12 }}>
        Pas assez de vues pour un tour exploitable.
      </div>
    );
  }

  const allLoaded = loaded >= count;

  return (
    <div style={{ fontFamily: "var(--font-apple)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: ACCENT, textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--c-aaa)" }}>{index + 1} / {count}</div>
      </div>

      <div
        ref={boxRef}
        onMouseDown={e => { e.preventDefault(); beginDrag(e.clientX); }}
        onTouchStart={e => beginDrag(e.touches[0].clientX)}
        onKeyDown={e => {
          if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
          if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
        }}
        tabIndex={0}
        role="slider"
        aria-label="Rotation du véhicule"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        style={{
          position: "relative", height, background: "var(--c-0f0f0f)",
          border: "1px solid var(--c-2a2a2a)", borderRadius: 4, overflow: "hidden",
          cursor: "ew-resize", touchAction: "pan-y", userSelect: "none", outline: "none",
        }}
      >
        {/* Toutes les vues sont montées et masquées : basculer `display` est
            instantané, alors que changer `src` reflasherait à chaque degré. */}
        {frames.map((src, i) => (
          <img
            key={i} src={src} alt="" draggable={false}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "contain", display: i === index ? "block" : "none",
              pointerEvents: "none",
            }}
          />
        ))}

        {!allLoaded && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-aaa)", fontSize: 11, letterSpacing: 1 }}>
            Chargement des vues… {loaded}/{count}
          </div>
        )}

        {allLoaded && !hasDragged && (
          <div style={{
            position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.65)", borderRadius: 3, padding: "6px 14px",
            fontSize: 11, color: "#fff", letterSpacing: 1, pointerEvents: "none",
          }}>
            ↔ Glissez pour faire tourner
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={() => step(-1)}
          style={{ flex: 1, background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "8px 0", fontSize: 12, borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
          ‹
        </button>
        <button onClick={() => step(1)}
          style={{ flex: 1, background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "8px 0", fontSize: 12, borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
          ›
        </button>
        {onClose && (
          <button onClick={onClose}
            style={{ flex: "0 0 auto", background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "8px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}
