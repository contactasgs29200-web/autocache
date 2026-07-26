import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Transition « écran de connexion → application ».
 *
 * Déroulé (≈ 1 s au total) :
 *   1. la carte de connexion s'efface (classe `ac-auth-out`, jouée par AuthScreen) ;
 *   2. le logo AutoCache apparaît au centre d'un voile opaque, avec un anneau
 *      qui se trace autour et le nom de la marque qui se resserre ;
 *   3. le voile se dissipe sur l'application pendant que le logo rejoint sa
 *      place définitive dans l'en-tête — le même hexagone d'un écran à l'autre.
 */

// Taille du logo au centre de l'écran ; sert de référence au facteur d'échelle
// du vol vers l'en-tête.
const LOGO_SIZE = 64;
// Position de repli si l'en-tête n'a pas encore été mesuré (logo 22 px, en-tête
// de 56 px de haut, 28 px de marge à gauche sur grand écran).
const FALLBACK_TARGET = { x: 39, y: 28, size: 22 };

export const AUTH_EXIT_MS = 260;   // effacement de la carte de connexion
const OVERLAY_MS = 980;            // voile + vol du logo
const REDUCED_MS = 200;            // variante « animations réduites »
// Filet de sécurité : si l'événement de fin d'animation n'arrive pas (onglet en
// arrière-plan, animations désactivées…), le voile se retire quand même.
const FALLBACK_MS = OVERLAY_MS + 600;

export function prefersReducedMotion() {
  return typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const AUTH_MOTION_CSS = `
@keyframes ac-auth-out{
  from{ opacity:1; transform:none; }
  to  { opacity:0; transform:scale(.965) translateY(-8px); }
}
.ac-auth-out{ animation:ac-auth-out ${AUTH_EXIT_MS}ms cubic-bezier(.4,0,1,1) both; pointer-events:none; }

/* Voile plein écran, de la couleur du fond : le raccord avec l'écran de
   connexion puis avec l'application est invisible. Il se dissipe au moment où
   le logo s'élance, pour que l'application se découvre pendant le vol. */
@keyframes ac-tr-veil{ from{ opacity:1; } to{ opacity:0; } }
.ac-tr-veil{
  position:absolute; inset:0; background:var(--c-1c1c1c);
  animation:ac-tr-veil 400ms cubic-bezier(.4,0,.2,1) 420ms both;
}

/* Halo diffus derrière le logo — éteint avant que l'application se découvre. */
@keyframes ac-tr-glow{
  0%  { opacity:0; transform:translate(-50%,-50%) scale(.6); }
  35% { opacity:1; }
  100%{ opacity:0; transform:translate(-50%,-50%) scale(1.3); }
}
.ac-tr-glow{
  position:absolute; left:50%; top:50%; width:320px; height:320px;
  background:radial-gradient(circle, rgba(242,101,34,.2) 0%, rgba(242,101,34,0) 68%);
  animation:ac-tr-glow 540ms ease-out both;
}

/* Anneau qui se trace autour du logo, refermé avant le décollage. */
@keyframes ac-tr-ring{
  0%  { stroke-dashoffset:283; opacity:0; }
  18% { opacity:.85; }
  78% { stroke-dashoffset:0; opacity:.8; }
  100%{ stroke-dashoffset:0; opacity:0; }
}
@keyframes ac-tr-ring-scale{
  0%  { transform:translate(-50%,-50%) scale(.86) rotate(-90deg); }
  78% { transform:translate(-50%,-50%) scale(1) rotate(-90deg); }
  100%{ transform:translate(-50%,-50%) scale(1.12) rotate(-90deg); }
}
.ac-tr-ring{
  position:absolute; left:50%; top:50%;
  animation:ac-tr-ring-scale 440ms cubic-bezier(.5,0,.2,1) 40ms both;
}
.ac-tr-ring circle{
  fill:none; stroke:#f26522; stroke-width:1; stroke-linecap:round;
  stroke-dasharray:283;
  animation:ac-tr-ring 440ms cubic-bezier(.5,0,.2,1) 40ms both;
}

/* Nom de la marque : les lettres se resserrent en apparaissant. */
@keyframes ac-tr-word{
  0%  { opacity:0; letter-spacing:16px; transform:translate(-50%,6px); }
  34% { opacity:1; letter-spacing:6px; transform:translate(-50%,0); }
  62% { opacity:1; }
  100%{ opacity:0; letter-spacing:6px; transform:translate(-50%,0); }
}
.ac-tr-word{
  position:absolute; left:50%; top:calc(50% + 62px);
  display:flex; align-items:baseline; gap:8px; white-space:nowrap;
  font-size:15px; font-weight:700; text-transform:uppercase;
  color:var(--c-ddd5c8); font-family:var(--font-apple);
  animation:ac-tr-word 440ms cubic-bezier(.2,.7,.3,1) 120ms both;
}
.ac-tr-word i{ font-style:normal; font-size:9px; letter-spacing:2px; color:#f26522; }

/* Apparition du logo, puis vol vers l'en-tête (deux éléments imbriqués : le
   rebond et le déplacement gardent chacun leur propre courbe). Le logo reste
   opaque jusqu'à destination et ne s'efface qu'une fois superposé à celui de
   l'en-tête : le relais d'un hexagone à l'autre est invisible. */
@keyframes ac-tr-pop{
  0%  { opacity:0; transform:scale(.5); }
  30% { opacity:1; }
  100%{ opacity:1; transform:scale(1); }
}
.ac-tr-pop{ animation:ac-tr-pop 380ms cubic-bezier(.34,1.4,.5,1) both; }

@keyframes ac-tr-fly{
  0%  { transform:translate(-50%,-50%) scale(1); opacity:1; }
  90% { opacity:1; }
  100%{ transform:translate(calc(-50% + var(--ac-fly-x,0px)), calc(-50% + var(--ac-fly-y,0px)))
                  scale(var(--ac-fly-s,.344));
        opacity:0; }
}
.ac-tr-fly{
  position:absolute; left:50%; top:50%; line-height:0;
  animation:ac-tr-fly 540ms cubic-bezier(.55,0,.25,1) 400ms both;
}

/* Apparition de l'application derrière le voile. */
@keyframes ac-app-enter{ from{ opacity:0; } to{ opacity:1; } }
.ac-app-enter{ animation:ac-app-enter 360ms cubic-bezier(.4,0,.2,1) 400ms both; }

@media (prefers-reduced-motion: reduce){
  .ac-auth-out{ animation-duration:120ms; }
  .ac-app-enter{ animation:ac-app-enter 160ms linear both; }
}
`;

const Hexagon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 22 22">
    <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
    <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#090909" />
  </svg>
);

export default function AuthTransition({ onDone }) {
  const flyRef = useRef(null);
  const reduced = prefersReducedMotion();

  // Cible du vol : le logo de l'en-tête, déjà monté derrière le voile. La
  // mesure a lieu avant la peinture, donc aucune image n'est affichée avec les
  // valeurs de repli.
  useLayoutEffect(() => {
    const el = flyRef.current;
    if (!el) return;
    const rect = document.querySelector("[data-ac-logo]")?.getBoundingClientRect();
    const target = rect && rect.width
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width }
      : FALLBACK_TARGET;
    el.style.setProperty("--ac-fly-x", `${Math.round(target.x - window.innerWidth / 2)}px`);
    el.style.setProperty("--ac-fly-y", `${Math.round(target.y - window.innerHeight / 2)}px`);
    el.style.setProperty("--ac-fly-s", (target.size / LOGO_SIZE).toFixed(3));
  }, []);

  // Le retrait suit la fin réelle du vol (voir onAnimationEnd) ; ce délai n'est
  // qu'un secours, d'où sa marge.
  useEffect(() => {
    const t = setTimeout(onDone, reduced ? REDUCED_MS : FALLBACK_MS);
    return () => clearTimeout(t);
  }, [onDone, reduced]);

  // Animations réduites : pas de voile ni de vol, l'application prend la main
  // tout de suite (le fondu court de .ac-app-enter suffit).
  if (reduced) return null;

  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none", overflow: "hidden" }}>
      <style>{AUTH_MOTION_CSS}</style>
      <div className="ac-tr-veil" />
      <div className="ac-tr-glow" />
      <svg className="ac-tr-ring" width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="45" />
      </svg>
      <div className="ac-tr-word">AutoCache<i>Pro</i></div>
      <div className="ac-tr-fly" ref={flyRef}
        onAnimationEnd={e => { if (e.animationName === "ac-tr-fly") onDone(); }}>
        <div className="ac-tr-pop"><Hexagon size={LOGO_SIZE} /></div>
      </div>
    </div>
  );
}
