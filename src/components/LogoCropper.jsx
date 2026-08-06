import { useRef, useState, useEffect } from "react";
import { resizeCropBox, squareCropBox } from "../logoCrop.js";

/*
 * LogoCropper
 * ───────────
 * Recadre un logo importé, en rectangle ou en rond.
 *
 * Le rond n'est pas qu'un habillage : un logo circulaire (BMW, Mercedes…)
 * exporté depuis un site arrive presque toujours dans un carré blanc ou avec
 * des marges inégales. Le découper en rond donne un PNG transparent hors du
 * disque, qui se pose proprement sur une bande de couleur.
 *
 *   src      : data URL du logo à recadrer (l'original, jamais un déjà rogné)
 *   onApply  : reçoit le data URL PNG recadré
 *   onCancel : ferme sans rien changer
 */

const ORANGE = "#f26522";
const HANDLES = ["tl", "tr", "bl", "br"];

const btn = (bg, color, border) => ({
  background: bg, color, border,
  fontFamily: "var(--font-apple)", fontSize: 11, fontWeight: 700,
  letterSpacing: 1, textTransform: "uppercase", borderRadius: 2,
  padding: "6px 14px", cursor: "pointer",
});

export default function LogoCropper({ src, onApply, onCancel }) {
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const [shape, setShape] = useState("rect"); // "rect" | "circle"
  const [box, setBox] = useState({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  // Dimensions natives : sans elles, un cadre « carré » en coordonnées
  // normalisées ne l'est pas en pixels dès que le logo n'est pas carré, et le
  // rond sortirait en ovale.
  const [nat, setNat] = useState(null);
  const aspect = nat && nat.h ? nat.w / nat.h : 1;

  // Passage en rond : ramène la sélection à un carré en pixels.
  const toShape = (next) => {
    setShape(next);
    if (next !== "circle") return;
    setBox(b => squareCropBox(b, aspect));
  };

  // Les dimensions natives n'arrivent qu'au chargement de l'<img> : un cadre
  // rond posé avant doit être re-carré une fois l'aspect connu.
  useEffect(() => { if (shape === "circle") setBox(b => squareCropBox(b, aspect)); }, [aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  const [dragging, setDragging] = useState(false);

  const startDrag = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    const p = point(e);
    dragRef.current = { type, startMx: p.x, startMy: p.y, startBox: { ...box } };
    setDragging(true);
  };

  // Le suivi se fait au niveau du document : agrandir une sélection demande
  // souvent de sortir du cadre, et un glissement qui s'arrête au bord — ou qui
  // reste « collé » parce que le bouton a été relâché dehors — est pénible.
  useEffect(() => {
    if (!dragging) return;
    const move = (e) => {
      const d = dragRef.current;
      if (!d || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (e.cancelable) e.preventDefault();
      const p = point(e);
      setBox(resizeCropBox(d.startBox, d.type,
        (p.x - d.startMx) / rect.width, (p.y - d.startMy) / rect.height,
        shape === "circle" ? aspect : 0));
    };
    const up = () => { dragRef.current = null; setDragging(false); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
    document.addEventListener("touchcancel", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", up);
    };
  }, [dragging, shape, aspect]);

  const apply = () => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.round(box.x * img.naturalWidth);
      const sy = Math.round(box.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(box.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(box.h * img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = sw; c.height = sh;
      const ctx = c.getContext("2d");
      if (shape === "circle") {
        ctx.beginPath();
        ctx.ellipse(sw / 2, sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      onApply(c.toDataURL("image/png")); // PNG : le hors-disque doit rester transparent
    };
    img.onerror = () => onCancel();
    img.src = src;
  };

  const pct = (v) => `${v * 100}%`;
  const shade = "rgba(0,0,0,0.6)";

  return (
    <div style={{ background: "var(--c-0a0a0a)", border: "1px solid var(--c-252525)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 12px 0" }}>
        {[["rect", "▭ Rectangle"], ["circle", "◯ Rond"]].map(([k, label]) => (
          <button key={k} onClick={() => toShape(k)}
            style={{ flex: 1, padding: "6px 0", fontSize: 10, fontFamily: "var(--font-apple)", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", borderRadius: 2,
              background: shape === k ? ORANGE : "var(--c-161616)", color: shape === k ? "#090909" : "var(--c-777)",
              border: `1px solid ${shape === k ? ORANGE : "var(--c-2a2a2a)"}` }}>{label}</button>
        ))}
      </div>
      <div ref={containerRef}
        style={{ position: "relative", userSelect: "none", touchAction: "none", margin: 12, overflow: "hidden" }}>
        <img src={src} draggable={false} style={{ width: "100%", display: "block" }}
          onLoad={e => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })} />
        {/* Voile : tout ce qui sera coupé. En rond, il épouse le disque —
            sinon les quatre coins, pourtant destinés à disparaître, resteraient
            en clair et l'aperçu mentirait sur le résultat. */}
        {shape === "circle" ? (
          <div style={{ position: "absolute", left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h),
            borderRadius: "50%", boxShadow: `0 0 0 9999px ${shade}`, pointerEvents: "none" }} />
        ) : (<>
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: pct(box.y), background: shade }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: pct(1 - box.y - box.h), background: shade }} />
          <div style={{ position: "absolute", top: pct(box.y), left: 0, width: pct(box.x), height: pct(box.h), background: shade }} />
          <div style={{ position: "absolute", top: pct(box.y), right: 0, width: pct(1 - box.x - box.w), height: pct(box.h), background: shade }} />
        </>)}
        {/* Sélection */}
        <div onMouseDown={e => startDrag(e, "move")} onTouchStart={e => startDrag(e, "move")}
          style={{ position: "absolute", left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h),
            border: `2px solid ${ORANGE}`, borderRadius: shape === "circle" ? "50%" : 0, boxSizing: "border-box", cursor: "move" }} />
        {HANDLES.map(h => {
          const isLeft = h[1] === "l", isTop = h[0] === "t";
          return (
            <div key={h} onMouseDown={e => startDrag(e, h)} onTouchStart={e => startDrag(e, h)}
              style={{ position: "absolute",
                left: `calc(${pct(isLeft ? box.x : box.x + box.w)} - 7px)`,
                top: `calc(${pct(isTop ? box.y : box.y + box.h)} - 7px)`,
                width: 14, height: 14, background: ORANGE, borderRadius: 2, zIndex: 2,
                cursor: h === "tl" || h === "br" ? "nwse-resize" : "nesw-resize" }} />
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 12px 10px", justifyContent: "center" }}>
        <button onClick={apply} style={btn("#2a6b2a", "var(--c-ddd5c8)", "1px solid #3a8a3a")}>Appliquer</button>
        <button onClick={onCancel} style={btn("var(--c-181818)", "var(--c-ddd)", "1px solid var(--c-2a2a2a)")}>Annuler</button>
      </div>
    </div>
  );
}

const point = (e) => (e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                               : { x: e.clientX, y: e.clientY });
