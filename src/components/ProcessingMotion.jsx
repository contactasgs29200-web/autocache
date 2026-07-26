/**
 * Animation de lancement du traitement des photos.
 *
 * Même langage visuel que la transition de connexion : le voile, l'hexagone
 * AutoCache et l'anneau orange. Au lancement, l'anneau se trace autour du logo
 * — le geste d'amorçage — puis il reste en place et se remplit au fil des
 * photos traitées. Le logo respire lentement pour montrer que le travail est
 * en cours, et la fermeture se fait en fondu une fois le lot terminé.
 */

const RING = 96;                    // diamètre de l'anneau
const R = 45;                       // rayon du tracé (1 px de marge pour l'épaisseur)
const C = 2 * Math.PI * R;          // circonférence, base des pointillés
const LOGO = 40;

export const PROCESSING_EXIT_MS = 260;

export const PROCESSING_MOTION_CSS = `
/* Ouverture et fermeture du voile de traitement. */
@keyframes ac-proc-veil{ from{ opacity:0; } to{ opacity:1; } }
.ac-proc-veil{ animation:ac-proc-veil 240ms cubic-bezier(.4,0,.2,1) both; }
.ac-proc-veil-out{ animation:ac-proc-veil ${PROCESSING_EXIT_MS}ms cubic-bezier(.4,0,1,1) reverse both; }

/* Onde unique au moment du lancement. */
@keyframes ac-proc-pulse{
  0%  { opacity:.45; transform:scale(.72); }
  100%{ opacity:0;   transform:scale(1.5); }
}
.ac-proc-pulse{
  position:absolute; left:0; top:0; width:100%; height:100%;
  border:1px solid #f26522; border-radius:50%;
  animation:ac-proc-pulse 720ms cubic-bezier(.2,.7,.3,1) 160ms both;
}

/* L'anneau se trace au lancement ; l'arc orange se remplit ensuite. */
@keyframes ac-proc-draw{ from{ stroke-dashoffset:${C.toFixed(1)}; } to{ stroke-dashoffset:0; } }
@keyframes ac-proc-fade{ from{ opacity:0; } to{ opacity:1; } }
.ac-proc-ring{ position:absolute; left:0; top:0; transform:rotate(-90deg); }
/* Couleur fixe et non variable de thème : le voile est toujours sombre, même
   en mode jour, donc la piste doit rester discrète dans les deux cas. */
.ac-proc-track{
  fill:none; stroke:rgba(255,255,255,.16); stroke-width:1;
  stroke-dasharray:${C.toFixed(1)};
  animation:ac-proc-draw 520ms cubic-bezier(.5,0,.2,1) 120ms both;
}
.ac-proc-arc{
  fill:none; stroke:#f26522; stroke-width:2; stroke-linecap:round;
  transition:stroke-dashoffset 500ms cubic-bezier(.4,0,.2,1);
  animation:ac-proc-fade 320ms ease 560ms both;
}

/* Apparition du logo, puis respiration lente pendant tout le traitement. */
@keyframes ac-proc-pop{
  0%  { opacity:0; transform:scale(.5); }
  30% { opacity:1; }
  100%{ opacity:1; transform:scale(1); }
}
@keyframes ac-proc-breathe{
  0%,100%{ transform:scale(1); }
  50%    { transform:scale(1.06); }
}
.ac-proc-pop{ animation:ac-proc-pop 380ms cubic-bezier(.34,1.4,.5,1) 80ms both; }
.ac-proc-breathe{ animation:ac-proc-breathe 2400ms ease-in-out 620ms infinite; }

/* Les deux lignes de texte encadrent l'anneau et montent ensemble, puis le
   mini-jeu suit. */
@keyframes ac-proc-rise{
  from{ opacity:0; transform:translateY(8px); }
  to  { opacity:1; transform:none; }
}
.ac-proc-rise-1{ animation:ac-proc-rise 320ms cubic-bezier(.2,.7,.3,1) 300ms both; }
.ac-proc-rise-2{ animation:ac-proc-rise 320ms cubic-bezier(.2,.7,.3,1) 430ms both; }

/* « Traitement en cours » : couleurs fixes, le voile est toujours sombre. */
.ac-proc-label{
  display:flex; align-items:center;
  font-family:var(--font-apple); font-size:11px; font-weight:700;
  letter-spacing:3px; text-transform:uppercase;
  color:rgba(255,255,255,.62);
}
/* Trois points qui s'allument en vague pour signaler l'attente. */
@keyframes ac-proc-dot{
  0%,60%,100%{ opacity:.2; }
  30%        { opacity:1; }
}
.ac-proc-dots{ display:inline-flex; align-items:center; gap:3px; margin-left:2px; }
.ac-proc-dots i{
  width:3px; height:3px; border-radius:50%; background:currentColor; display:block;
  animation:ac-proc-dot 1200ms ease-in-out infinite;
}
.ac-proc-dots i:nth-child(2){ animation-delay:160ms; }
.ac-proc-dots i:nth-child(3){ animation-delay:320ms; }

@media (prefers-reduced-motion: reduce){
  .ac-proc-veil{ animation-duration:120ms; }
  .ac-proc-pulse,
  .ac-proc-breathe{ animation:none; }
  .ac-proc-dots i{ animation:none; opacity:.7; }
  .ac-proc-track{ animation:ac-proc-fade 160ms linear both; stroke-dashoffset:0; }
  .ac-proc-pop,
  .ac-proc-rise-1,
  .ac-proc-rise-2{ animation:ac-proc-fade 160ms linear both; }
}
`;

/** Ligne « Traitement en cours… » ; les points s'arrêtent une fois le lot fini. */
export function ProcessingLabel({ running }) {
  return (
    <div className="ac-proc-label">
      {running ? "Traitement en cours" : "Traitement terminé"}
      {running && <span className="ac-proc-dots"><i /><i /><i /></span>}
    </div>
  );
}

/** Hexagone AutoCache + anneau de progression. `pct` : 0 → 100. */
export default function ProcessingIndicator({ pct = 0 }) {
  const ratio = Math.min(1, Math.max(0, pct / 100));
  return (
    <div style={{ position: "relative", width: RING, height: RING, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span className="ac-proc-pulse" />
      <svg className="ac-proc-ring" width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
        <circle className="ac-proc-track" cx={RING / 2} cy={RING / 2} r={R} />
        <circle className="ac-proc-arc" cx={RING / 2} cy={RING / 2} r={R}
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - ratio) }} />
      </svg>
      <div className="ac-proc-pop">
        <div className="ac-proc-breathe" style={{ lineHeight: 0 }}>
          <svg width={LOGO} height={LOGO} viewBox="0 0 22 22">
            <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
            <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#090909" />
          </svg>
        </div>
      </div>
    </div>
  );
}
