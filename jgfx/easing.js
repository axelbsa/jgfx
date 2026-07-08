/**
 * easing.js — the standard easing functions from https://easings.net, as pure
 * scalar functions. No dependency: each is just arithmetic on a normalized time
 * `t ∈ [0, 1]`, returning an eased progress (usually in [0, 1], though `back`
 * and `elastic` deliberately overshoot).
 *
 * Pair them with interpolation: `lerp(a, b, easeInOutCubic(t))`. Names match
 * easings.net exactly so the curves there describe these one-to-one.
 *
 * Every function maps 0→0 and 1→1. Inputs are assumed already normalized to
 * [0, 1]; clamp beforehand if your timer can overshoot.
 */

const { pow, sin, cos, sqrt, PI } = Math;

// Shared constants (as named on easings.net).
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * PI) / 3;
const c5 = (2 * PI) / 4.5;

/** No easing — returns t unchanged. */
export const linear = (t) => t;

/* -------------------------------------------------------------- sine ----- */
export const easeInSine = (t) => 1 - cos((t * PI) / 2);
export const easeOutSine = (t) => sin((t * PI) / 2);
export const easeInOutSine = (t) => -(cos(PI * t) - 1) / 2;

/* -------------------------------------------------------------- quad ----- */
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t) =>
  t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2;

/* -------------------------------------------------------------- cubic ---- */
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2;

/* -------------------------------------------------------------- quart ---- */
export const easeInQuart = (t) => t * t * t * t;
export const easeOutQuart = (t) => 1 - pow(1 - t, 4);
export const easeInOutQuart = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - pow(-2 * t + 2, 4) / 2;

/* -------------------------------------------------------------- quint ---- */
export const easeInQuint = (t) => t * t * t * t * t;
export const easeOutQuint = (t) => 1 - pow(1 - t, 5);
export const easeInOutQuint = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - pow(-2 * t + 2, 5) / 2;

/* -------------------------------------------------------------- expo ----- */
export const easeInExpo = (t) => (t === 0 ? 0 : pow(2, 10 * t - 10));
export const easeOutExpo = (t) => (t === 1 ? 1 : 1 - pow(2, -10 * t));
export const easeInOutExpo = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? pow(2, 20 * t - 10) / 2
        : (2 - pow(2, -20 * t + 10)) / 2;

/* -------------------------------------------------------------- circ ----- */
export const easeInCirc = (t) => 1 - sqrt(1 - pow(t, 2));
export const easeOutCirc = (t) => sqrt(1 - pow(t - 1, 2));
export const easeInOutCirc = (t) =>
  t < 0.5
    ? (1 - sqrt(1 - pow(2 * t, 2))) / 2
    : (sqrt(1 - pow(-2 * t + 2, 2)) + 1) / 2;

/* -------------------------------------------------------------- back ----- */
export const easeInBack = (t) => c3 * t * t * t - c1 * t * t;
export const easeOutBack = (t) =>
  1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2);
export const easeInOutBack = (t) =>
  t < 0.5
    ? (pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;

/* ------------------------------------------------------------ elastic ---- */
export const easeInElastic = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : -pow(2, 10 * t - 10) * sin((t * 10 - 10.75) * c4);
export const easeOutElastic = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : pow(2, -10 * t) * sin((t * 10 - 0.75) * c4) + 1;
export const easeInOutElastic = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(pow(2, 20 * t - 10) * sin((20 * t - 11.125) * c5)) / 2
        : (pow(2, -20 * t + 10) * sin((20 * t - 11.125) * c5)) / 2 + 1;

/* ------------------------------------------------------------- bounce ---- */
export const easeOutBounce = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
export const easeInBounce = (t) => 1 - easeOutBounce(1 - t);
export const easeInOutBounce = (t) =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;
