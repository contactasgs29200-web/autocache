import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * MaskEditor — Manual mask correction tool for showroom cutouts.
 *
 * Props:
 *   cutoutDataURL    – current cutout with alpha (what to edit)
 *   originalDataURL  – original full image (for restore reference)
 *   onApply          – (correctedCutoutDataURL) => void
 *   onCancel         – () => void
 */
export default function MaskEditor({ cutoutDataURL, originalDataURL, onApply, onCancel }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);

  const [mode, setMode] = useState('erase'); // 'erase' | 'recover' | 'restore' | 'glass'
  const [brushSize, setBrushSize] = useState(10);
  const [glassOpacity, setGlassOpacity] = useState(110); // 0..255, alpha appliqué en mode "Vitrages"
  const [bgMode, setBgMode] = useState('checker'); // 'checker' | 'white' | 'black' | 'source'
  const lastPosRef = useRef(null); // dernière position peinte du tracé courant (pour interpoler le trait)
  const strokeOverlayRef = useRef(null); // canvas de teinte pour visualiser la "sélection" en mode Récupérer
  const [isDrawing, setIsDrawing] = useState(false);

  // Zoom & pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Undo/redo
  const historyRef = useRef([]);
  const historyIdxRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Image dimensions
  const dimRef = useRef({ w: 0, h: 0, scale: 1 });
  // Original alpha for "restore" (undo erasures within the current edit)
  const origAlphaRef = useRef(null);
  // Original full-image RGBA for "recover" (paint back parts the cutout dropped)
  const origPixelsRef = useRef(null);

  // Initialize canvas from cutoutDataURL
  useEffect(() => {
    if (!cutoutDataURL) return;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;

      // Compute display scale to fit in viewport
      const maxW = window.innerWidth * 0.88;
      const maxH = window.innerHeight * 0.70;
      const scale = Math.min(1, maxW / w, maxH / h);
      dimRef.current = { w, h, scale };

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = Math.round(w * scale) + 'px';
      canvas.style.height = Math.round(h * scale) + 'px';

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0);

      // Save initial state to history
      const initial = ctx.getImageData(0, 0, w, h);
      historyRef.current = [initial];
      historyIdxRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);

      // Extract original alpha for restore mode
      origAlphaRef.current = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        origAlphaRef.current[i] = initial.data[i * 4 + 3];
      }

      // Size the stroke overlay (recover-mode tint) to match the cutout.
      const so = strokeOverlayRef.current;
      if (so) {
        so.width = w;
        so.height = h;
        so.style.width = Math.round(w * scale) + 'px';
        so.style.height = Math.round(h * scale) + 'px';
        so.getContext('2d').clearRect(0, 0, w, h);
      }
    };
    img.src = cutoutDataURL;
  }, [cutoutDataURL]);

  // Load the original full-image (pre-cutout) and resample it to the cutout's
  // dimensions so "Récupérer" can paint RGB pixels straight from the source.
  // We also keep the resampled Image element around so the "Source" background
  // mode can use the exact same buffer that Récupérer reads from.
  const origImageElRef = useRef(null);
  const [origReady, setOrigReady] = useState(false);
  useEffect(() => {
    if (!originalDataURL) { origPixelsRef.current = null; origImageElRef.current = null; setOrigReady(false); return; }
    let cancelled = false;
    setOrigReady(false);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      origImageElRef.current = img;
      const { w, h } = dimRef.current;
      if (!w || !h) {
        // The cutout hasn't finished loading yet — retry once it has.
        const retry = setInterval(() => {
          const { w: w2, h: h2 } = dimRef.current;
          if (!w2 || !h2) return;
          clearInterval(retry);
          if (cancelled) return;
          const c = document.createElement('canvas');
          c.width = w2; c.height = h2;
          c.getContext('2d').drawImage(img, 0, 0, w2, h2);
          origPixelsRef.current = c.getContext('2d').getImageData(0, 0, w2, h2).data;
          setOrigReady(true);
        }, 50);
        setTimeout(() => clearInterval(retry), 5000);
        return;
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      origPixelsRef.current = c.getContext('2d').getImageData(0, 0, w, h).data;
      setOrigReady(true);
    };
    img.src = originalDataURL;
    return () => { cancelled = true; };
  }, [originalDataURL, cutoutDataURL]);

  // Draw checker / white / black / source background on overlay canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const { w, h, scale } = dimRef.current;
    if (!w) return;
    overlay.width = w;
    overlay.height = h;
    overlay.style.width = Math.round(w * scale) + 'px';
    overlay.style.height = Math.round(h * scale) + 'px';
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (bgMode === 'white') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    } else if (bgMode === 'black') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    } else if (bgMode === 'source' && origImageElRef.current) {
      // Affiche la photo originale derrière le cutout — en VRAIES COULEURS
      // pour que l'utilisateur voie clairement la source dans laquelle
      // "Récupérer" va piocher. (En mode recover, l'opacité du cutout est
      // réduite côté CSS pour que l'original reste l'image dominante.)
      ctx.drawImage(origImageElRef.current, 0, 0, w, h);
    } else {
      // Checker pattern (default)
      const sz = 16;
      for (let y = 0; y < h; y += sz) {
        for (let x = 0; x < w; x += sz) {
          ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#ccc' : '#fff';
          ctx.fillRect(x, y, sz, sz);
        }
      }
    }
  }, [bgMode, cutoutDataURL, origReady]);

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = dimRef.current;
    const ctx = canvas.getContext('2d');
    const snap = ctx.getImageData(0, 0, w, h);
    const idx = historyIdxRef.current;
    // Truncate any redo states
    historyRef.current = historyRef.current.slice(0, idx + 1);
    historyRef.current.push(snap);
    // Limit to 20 entries
    if (historyRef.current.length > 20) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    setCanUndo(true);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  }, []);

  const getCanvasPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { scale } = dimRef.current;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / (scale * zoom),
      y: (clientY - rect.top) / (scale * zoom),
    };
  }, [zoom]);

  const paint = useCallback((x, y) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = dimRef.current;
    if (!w) return;
    const ctx = canvas.getContext('2d');
    const r = brushSize / 2;

    // On peint un DISQUE BALAYÉ entre la dernière position et la position
    // courante : pointermove arrivant à ~60 Hz, sans interpolation un trait
    // rapide laisse des points isolés. Avec la distance-au-segment, le trait
    // reste continu quel que soit le rythme des événements.
    const prev = lastPosRef.current;
    const ax = prev ? prev.x : x, ay = prev ? prev.y : y;
    const bx = x,                  by = y;

    const xMin = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const yMin = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const xMax = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const yMax = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    if (xMax < xMin || yMax < yMin) { lastPosRef.current = { x, y }; return; }

    const width = xMax - xMin + 1;
    const imgData = ctx.getImageData(xMin, yMin, width, yMax - yMin + 1);
    const data = imgData.data;
    const rSq = r * r;

    const sdx = bx - ax, sdy = by - ay;
    const segLenSq = sdx * sdx + sdy * sdy;

    const orig = origPixelsRef.current;
    for (let py = yMin; py <= yMax; py++) {
      for (let px = xMin; px <= xMax; px++) {
        // Projeté du pixel sur le segment, t borné à [0,1] (point pour t=0
        // ou t=1, segment au milieu) → couvre les deux disques extrêmes ET
        // la bande rectangulaire entre eux.
        let t = segLenSq > 0 ? ((px - ax) * sdx + (py - ay) * sdy) / segLenSq : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const cx = ax + t * sdx, cy = ay + t * sdy;
        const ddx = px - cx, ddy = py - cy;
        if (ddx * ddx + ddy * ddy > rSq) continue;

        const li = ((py - yMin) * width + (px - xMin)) * 4;
        if (mode === 'erase') {
          data[li + 3] = 0;
        } else if (mode === 'recover' && orig) {
          // Récupère le pixel RGB depuis la photo source (sauve antennes,
          // optiques, etc. perdues par la segmentation IA) — alpha plein.
          const oi = (py * w + px) * 4;
          data[li + 0] = orig[oi + 0];
          data[li + 1] = orig[oi + 1];
          data[li + 2] = orig[oi + 2];
          data[li + 3] = 255;
        } else if (mode === 'glass' && orig) {
          // Vitrages — RGB d'origine (reflets, teinte) avec alpha réduit
          // pour que le décor showroom transparaisse à travers.
          const oi = (py * w + px) * 4;
          data[li + 0] = orig[oi + 0];
          data[li + 1] = orig[oi + 1];
          data[li + 2] = orig[oi + 2];
          data[li + 3] = glassOpacity;
        } else {
          // Restaure depuis l'alpha initial du cutout (annule les coups de
          // gomme de la session — ne ramène pas ce que l'IA n'a jamais gardé).
          const oi = py * w + px;
          data[li + 3] = origAlphaRef.current ? origAlphaRef.current[oi] : 255;
        }
      }
    }
    ctx.putImageData(imgData, xMin, yMin);

    // Feedback visuel en mode Récupérer : teinte cyan translucide sur la zone
    // peinte, indépendante du fond. C'est ce qui matérialise la "sélection"
    // pour l'utilisateur — sans elle, peindre sur des pixels identiques à ceux
    // sous-jacents (source visible derrière) ne produit aucun changement
    // perceptible et donne l'impression que rien ne se passe.
    if (mode === 'recover') {
      const so = strokeOverlayRef.current;
      if (so) {
        const sctx = so.getContext('2d');
        sctx.strokeStyle = 'rgba(0, 200, 255, 0.55)';
        sctx.lineCap = 'round';
        sctx.lineJoin = 'round';
        sctx.lineWidth = brushSize;
        sctx.beginPath();
        sctx.moveTo(ax, ay);
        sctx.lineTo(bx, by);
        sctx.stroke();
      }
    }

    lastPosRef.current = { x, y };
  }, [brushSize, mode, glassOpacity]);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // Middle click or right click = pan
    if (e.button === 1 || e.button === 2) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    setIsDrawing(true);
    lastPosRef.current = null; // nouveau tracé : premier point isolé
    const pos = getCanvasPos(e);
    paint(pos.x, pos.y);
  }, [getCanvasPos, paint, pan]);

  const handlePointerMove = useCallback((e) => {
    e.stopPropagation();
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
      return;
    }
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    paint(pos.x, pos.y);
  }, [isDrawing, getCanvasPos, paint]);

  const handlePointerUp = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPosRef.current = null; // fin du tracé
    pushHistory();
  }, [isDrawing, pushHistory]);

  // Vide le calque de teinte (utilisé sur changement de mode et sur Apply/Cancel).
  const clearStrokeOverlay = useCallback(() => {
    const so = strokeOverlayRef.current;
    if (!so) return;
    const sctx = so.getContext('2d');
    sctx.clearRect(0, 0, so.width, so.height);
  }, []);

  // Quand on quitte le mode Récupérer, on efface la teinte : elle n'est
  // pertinente que pendant la sélection en cours.
  useEffect(() => {
    if (mode !== 'recover') clearStrokeOverlay();
  }, [mode, clearStrokeOverlay]);

  // Zoom with mouse wheel
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(10, Math.max(0.5, z * delta)));
  }, []);

  // Prevent context menu on right-click (used for panning)
  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleApply = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onApply) return;
    clearStrokeOverlay();
    onApply(canvas.toDataURL('image/png'));
  }, [onApply, clearStrokeOverlay]);

  // Reset zoom
  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const btnStyle = (active) => ({
    padding: '6px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: active ? 700 : 500,
    fontSize: 14,
    background: active ? '#3b82f6' : '#374151',
    color: '#fff',
    opacity: active === false ? 0.4 : 1,
    transition: 'all 0.15s',
  });

  return (
    <div
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onContextMenu={handleContextMenu}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Toolbar */}
      <div
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        style={{
          display: 'flex', gap: 8, padding: '10px 16px', marginBottom: 8,
          background: '#1f2937', borderRadius: 10, alignItems: 'center', flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button style={btnStyle(mode === 'erase')} onClick={() => setMode('erase')}>
          Gomme
        </button>
        <button style={btnStyle(mode === 'recover')} onClick={() => {
          setMode('recover');
          // NE PAS basculer le fond sur "Source" automatiquement : le cutout
          // étant désormais aligné au pixel près avec la photo d'origine, peindre
          // par-dessus revient à réécrire la même couleur → les traits sont
          // visuellement invisibles. Le fond par défaut (damier) fait apparaître
          // clairement les zones manquantes et chaque trait de récupération.
          if (bgMode === 'source') setBgMode('checker');
        }}>
          Récupérer
        </button>
        <button style={btnStyle(mode === 'glass')} onClick={() => {
          setMode('glass');
          // Switch to a finer brush by default in glass mode — windshield/window
          // outlines need a much tighter stroke than erase / recover.
          if (brushSize > 18) setBrushSize(10);
        }}>
          Vitrages
        </button>
        <button style={btnStyle(mode === 'restore')} onClick={() => setMode('restore')}>
          Restaurer
        </button>
        <span style={{ color: '#b3bac4', fontSize: 13, margin: '0 4px' }}>|</span>
        <label style={{ color: '#dde0e5', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Taille
          <input type="range" min={1} max={30} value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            onMouseDown={e => e.stopPropagation()}
            style={{ width: 80 }} />
          <span style={{ minWidth: 24, textAlign: 'right' }}>{brushSize}</span>
        </label>
        {mode === 'glass' && (
          <label style={{ color: '#dde0e5', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            Opacité
            <input type="range" min={40} max={220} value={glassOpacity}
              onChange={e => setGlassOpacity(Number(e.target.value))}
              onMouseDown={e => e.stopPropagation()}
              style={{ width: 80 }} />
            <span style={{ minWidth: 34, textAlign: 'right' }}>{Math.round(glassOpacity / 255 * 100)}%</span>
          </label>
        )}
        <span style={{ color: '#b3bac4', fontSize: 13, margin: '0 4px' }}>|</span>
        <button style={{ ...btnStyle(canUndo), fontSize: 18, lineHeight: 1, padding: '6px 12px' }} onClick={undo} disabled={!canUndo} title="Annuler" aria-label="Annuler">↶</button>
        <button style={{ ...btnStyle(canRedo), fontSize: 18, lineHeight: 1, padding: '6px 12px' }} onClick={redo} disabled={!canRedo} title="Refaire" aria-label="Refaire">↷</button>
        <span style={{ color: '#b3bac4', fontSize: 13, margin: '0 4px' }}>|</span>
        <select value={bgMode} onChange={e => setBgMode(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
          style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}>
          <option value="checker">Damier</option>
          <option value="white">Blanc</option>
          <option value="black">Noir</option>
          <option value="source" disabled={!origReady}>Source{origReady ? '' : ' (…)'}</option>
        </select>
        <span style={{ color: '#b3bac4', fontSize: 13, margin: '0 4px' }}>|</span>
        <button style={btnStyle(true)} onClick={resetZoom}>
          {Math.round(zoom * 100)}%
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        style={{
          position: 'relative',
          cursor: isPanningRef.current ? 'grabbing' : 'crosshair',
          overflow: 'hidden',
          width: '88vw',
          height: '70vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          position: 'relative',
          transition: isPanningRef.current ? 'none' : undefined,
        }}>
          <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
          <canvas ref={canvasRef}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            style={{ position: 'relative', zIndex: 1, touchAction: 'none' }}
          />
          {/* Calque de teinte : matérialise visuellement la zone "sélectionnée"
              en mode Récupérer, indépendamment du fond. pointerEvents:none →
              clicks et déplacements passent au canvas en-dessous. */}
          <canvas ref={strokeOverlayRef}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }} />
        </div>
      </div>

      {/* Help text */}
      <div style={{ color: '#828a96', fontSize: 12, marginTop: 6, textAlign: 'center' }}>
        Molette = zoom &nbsp;|&nbsp; Clic droit + glisser = deplacer &nbsp;|&nbsp; Clic gauche = peindre
      </div>

      {/* Bottom actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button
          onClick={(e) => { e.stopPropagation(); clearStrokeOverlay(); onCancel(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{
            padding: '10px 24px', background: '#4b5563', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15,
          }}
        >
          Annuler
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleApply(); }}
          onMouseDown={e => e.stopPropagation()}
          style={{
            padding: '10px 24px', background: '#10b981', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 600,
          }}
        >
          Appliquer
        </button>
      </div>
    </div>
  );
}
