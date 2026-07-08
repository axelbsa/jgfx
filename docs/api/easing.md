# Easing

The standard easing functions from [easings.net](https://easings.net/), as pure scalar
functions — no dependency.

**File:** `easing.js`

Each easing is a plain function of normalized time `t ∈ [0, 1]` that returns eased progress.
Feed that progress to interpolation — `lerp(a, b, easeInOutCubic(t))` — to give motion a
natural acceleration curve instead of a robotic constant speed. The names match easings.net
one-to-one, so the animated curves there describe these exactly.

```js
import { easing, math } from "./jgfx/index.js";
const { easeOutBack, easeInOutCubic } = easing;

// or straight from the file:
import { easeInOutQuad } from "./jgfx/easing.js";
```

---

## Usage

An easing shapes *time*; interpolation applies it to *values*. Drive a normalized `t` from
0→1 over your animation and ease it before interpolating:

```js
import { math, easing } from "./jgfx/index.js";
const { lerp, vec3 } = math;

const DURATION = 0.6; // seconds
let elapsed = 0;

function update(dt) {
  elapsed += dt;
  const t = math.clamp(elapsed / DURATION, 0, 1); // normalized, clamped
  const k = easing.easeOutCubic(t);               // eased progress

  const pos = vec3.lerp(startPos, endPos, k);     // apply to a value
  // ... write pos into a uniform / model matrix ...
}
```

Because an easing just returns a number, it composes with everything: `lerp`, `vec3.lerp`,
`quat.slerp`, or your own interpolation.

!!! tip "Clamp first"
    Easings assume `t` is already in `[0, 1]`. If your timer can overshoot (a frame spike, a
    loop that runs one tick long), `math.clamp(t, 0, 1)` before easing — otherwise `expo`,
    `back`, and `elastic` will extrapolate wildly outside the range.

!!! note "Overshoot is intentional"
    Every easing maps `0→0` and `1→1`, but `back` and `elastic` deliberately leave the
    `[0, 1]` range *in the middle* — `back` anticipates (dips below 0 / past 1) and `elastic`
    rings around the target. That's the effect; don't clamp the *output* unless you want to
    kill it.

---

## The functions

All take a single `number` and return a `number`. Grouped by family; within each family the
curve gets progressively sharper going down the table. See
[easings.net](https://easings.net/) for the visual shape of each.

| | In | Out | In-Out |
|-|----|-----|--------|
| **linear** | `linear` | — | — |
| **Sine** | `easeInSine` | `easeOutSine` | `easeInOutSine` |
| **Quad** | `easeInQuad` | `easeOutQuad` | `easeInOutQuad` |
| **Cubic** | `easeInCubic` | `easeOutCubic` | `easeInOutCubic` |
| **Quart** | `easeInQuart` | `easeOutQuart` | `easeInOutQuart` |
| **Quint** | `easeInQuint` | `easeOutQuint` | `easeInOutQuint` |
| **Expo** | `easeInExpo` | `easeOutExpo` | `easeInOutExpo` |
| **Circ** | `easeInCirc` | `easeOutCirc` | `easeInOutCirc` |
| **Back** | `easeInBack` | `easeOutBack` | `easeInOutBack` |
| **Elastic** | `easeInElastic` | `easeOutElastic` | `easeInOutElastic` |
| **Bounce** | `easeInBounce` | `easeOutBounce` | `easeInOutBounce` |

- **In** — starts slow, accelerates (ease *into* motion).
- **Out** — starts fast, decelerates (ease *out of* motion). The most natural for UI.
- **In-Out** — slow at both ends, fast in the middle.

31 functions total (`linear` + 10 families × 3).

---

## Choosing one

| Want | Try |
|------|-----|
| Subtle, natural UI motion | `easeOutQuad` / `easeOutCubic` |
| Snappy but smooth | `easeInOutCubic` / `easeInOutQuart` |
| Dramatic, sudden | `easeInOutExpo` |
| Playful overshoot | `easeOutBack` |
| Springy / bouncy | `easeOutElastic`, `easeOutBounce` |

---

## See also

- [Using Math & Transforms](../guides/math-and-transforms.md#animating-with-easings) — a
  worked animation example.
- [Math](math.md) — `lerp`, `clamp`, and the vector/quaternion interpolators easings feed.
- [easings.net](https://easings.net/) — the visual reference these mirror.
