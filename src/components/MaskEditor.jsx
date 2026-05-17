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

  const [mode, setMode] = useState('erase'); // 'erase' | 'restore'
  const [brushSize, setBrushSize] = useState(30);
  const [bgMode, setBgMode] = useState('checker'); // 'checker' | 'white' | 'black'
  const [isDrawing, setIsDrawing] = useState(false);

  // Undo/redo
  const historyRef = useRef([]);
  const historyIdxRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Image dimensions
  const dimRef = useRef({ w: 0, h: 0, scale: 1 });
  // Original alpha for restore mode
  const origAlphaRef = useRef(null);

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
    };
    img.src = cutoutDataURL;
  }, [cutoutDataURL]);

  // Draw checker/white/black background on overlay canvas
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
    if (bgMode === 'white') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    } else if (bgMode === 'black') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    } else {
      // Checker pattern
      const sz = 16;
      for (let y = 0; y < h; y += sz) {
        for (let x = 0; x < w; x += sz) {
          ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#ccc' : '#fff';
          ctx.fillRect(x, y, sz, sz);
        }
      }
    }
  }, [bgMode, cutoutDataURL]);

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
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  }, []);

  const paint = useCallback((x, y) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = dimRef.current;
    const ctx = canvas.getContext('2d');
    const r = brushSize / 2;
    const x0 = Math.max(0, Math.floor(x - r));
    const y0 = Math.max(0, Math.floor(y - r));
    const x1 = Math.min(w - 1, Math.ceil(x + r));
    const y1 = Math.min(h - 1, Math.ceil(y + r));
    const imgData = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const data = imgData.data;
    const rSq = r * r;

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - x, dy = py - y;
        if (dx * dx + dy * dy > rSq) continue;
        const li = ((py - y0) * (x1 - x0 + 1) + (px - x0)) * 4;
        if (mode === 'erase') {
          data[li + 3] = 0;
        } else {
          // Restore from original alpha
          const oi = py * w + px;
          data[li + 3] = origAlphaRef.current ? origAlphaRef.current[oi] : 255;
        }
      }
    }
    ctx.putImageData(imgData, x0, y0);
  }, [brushSize, mode]);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    setIsDrawing(true);
    const pos = getCanvasPos(e);
    paint(pos.x, pos.y);
  }, [getCanvasPos, paint]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    paint(pos.x, pos.y);
  }, [isDrawing, getCanvasPos, paint]);

  const handlePointerUp = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    pushHistory();
  }, [isDrawing, pushHistory]);

  const handleApply = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onApply) return;
    onApply(canvas.toDataURL('image/png'));
  }, [onApply]);

  const btnStyle = (active) => ({
    padding: '6px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: active ? 700 : 500,
    fontSize: 13,
    background: active ? '#3b82f6' : '#374151',
    color: '#fff',
    opacity: active === false ? 0.4 : 1,
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 16px', marginBottom: 8,
        background: '#1f2937', borderRadius: 10, alignItems: 'center', flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        <button style={btnStyle(mode === 'erase')} onClick={() => setMode('erase')}>
          Gomme
        </button>
        <button style={btnStyle(mode === 'restore')} onClick={() => setMode('restore')}>
          Restaurer
        </button>
        <span style={{ color: '#9ca3af', fontSize: 12, margin: '0 4px' }}>|</span>
        <label style={{ color: '#d1d5db', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Taille
          <input type="range" min={5} max={120} value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            style={{ width: 80 }} />
          <span style={{ minWidth: 24, textAlign: 'right' }}>{brushSize}</span>
        </label>
        <span style={{ color: '#9ca3af', fontSize: 12, margin: '0 4px' }}>|</span>
        <button style={btnStyle(canUndo)} onClick={undo} disabled={!canUndo}>Annuler</button>
        <button style={btnStyle(canRedo)} onClick={redo} disabled={!canRedo}>Refaire</button>
        <span style={{ color: '#9ca3af', fontSize: 12, margin: '0 4px' }}>|</span>
        <select value={bgMode} onChange={e => setBgMode(e.target.value)}
          style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}>
          <option value="checker">Damier</option>
          <option value="white">Blanc</option>
          <option value="black">Noir</option>
        </select>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} style={{ position: 'relative', cursor: 'crosshair' }}>
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
      </div>

      {/* Bottom actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={onCancel} style={{
          padding: '10px 24px', background: '#4b5563', color: '#fff',
          border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
        }}>
          Annuler
        </button>
        <button onClick={handleApply} style={{
          padding: '10px 24px', background: '#10b981', color: '#fff',
          border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
        }}>
          Appliquer
        </button>
      </div>
    </div>
  );
}
