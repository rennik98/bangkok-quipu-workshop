# Implementation Notes — Quipu of Conquest Decoder

How the code implements each stage of the pipeline shown in the app's
**// ALGORITHM PIPELINE** panel. Parse/decode/checksum/locate logic lives in
one shared, environment-agnostic module, `decoder.js`, used by both
`solve.js` (Node CLI, `require('./decoder')`) and `index.html` (browser,
`<script src="decoder.js">`) — no duplication, and it's covered by
`test/decoder.test.js` (`npm test`).

```
PARSE → DECODE → CHECKSUM → LOCATE → PLOT
```

---

## 1. PARSE

**Goal:** turn two flat CSV files into in-memory data the rest of the
pipeline can use.

- `parseCequeTable()` — `decoder.js:25`
  Reads `ID,Angle (deg)` rows into a `Map<cequeId, angleDeg>`. This table
  never changes per turtle; it's the fixed 41-line bearing reference.

- `parseInput()` — `decoder.js:36`
  Walks the data file line by line with a tiny state machine:
  - A line starting with `#` flips `section` between `TURTLE_DATA` and
    `QUIPU_RECORDS`.
  - In `TURTLE_DATA`, each row is `T<n>,marginal,plastron` → stored in a
    `turtles` map keyed by turtle id.
  - In `QUIPU_RECORDS`, three row shapes matter: a bare `T<n>` line (switch
    current turtle), a `P,...` line (pendant cord), and one or more
    `S,...` lines following it (subsidiary cords).

- `trimTrailingEmpty()` — `decoder.js:7`
  The CSVs come from a fixed 6-column spreadsheet export, so short rows like
  `P,2,6,,,` have empty trailing cells. Trimming only from the right (not
  filtering all empty strings) matters because a knot digit can legitimately
  be `0` — e.g. `S,0,0,6,8,4`.

- `digitsToNumber()` — `decoder.js:15`
  Joins the remaining digit fields and `parseInt`s them, e.g.
  `['0','0','6','8','4'] → 684`. It doesn't assume a fixed digit count, so a
  hidden test using wider/narrower cords still parses correctly.

**Output of this stage:** `turtles` (marginal/plastron per turtle) and a
`currentTurtle` / `currentCequeId` pointer used by the next stage as parsing
continues line by line — decode actually happens inline during parsing
(see below), not as a separate pass.

---

## 2. DECODE

**Goal:** undo the obfuscation applied to each subsidiary cord's value.

Happens inside the `else if (fields[0] === 'S')` branch of `parseInput()`
(`decoder.js:60-85`):

```js
const rawDistance = digitsToNumber(fields.slice(1));
const realDistance = rawDistance - currentCequeId * turtle.marginal;
```

The puzzle's obfuscation rule is:

```
Raw_Distance = Ceque_ID × Marginal_Scutes + Real_Distance
```

so recovering `Real_Distance` is just subtracting the known
`Ceque_ID × Marginal_Scutes` term back out. `currentCequeId` comes from the
most recent `P` row; `turtle.marginal` comes from the `TURTLE_DATA` row for
whichever turtle is currently active.

`Real_Distance` can come out **negative** for decoy rows (e.g.
`205 - 40×24 = -755` in the sample data) — that's expected and handled by
stage 3, not an error (see the `mod()` test for `-274`/`-755` in
`test/decoder.test.js`).

---

## 3. CHECKSUM

**Goal:** separate genuine distances from planted decoys.

Still inside the same `S` branch:

```js
const requiredMod = turtle.plastron % 5;
const actualMod = mod(realDistance, 5);
genuine: actualMod === requiredMod
```

The checksum rule from the puzzle:

```
Real_Distance % 5 == Plastron_Scutes % 5  →  genuine
otherwise                                  →  decoy, discard
```

`mod()` (`decoder.js:21`) implements *true* mathematical modulo —
`((n % m) + m) % m` — instead of JavaScript's native `%`, which returns a
negative result for a negative `n` (e.g. `-274 % 5 === -4` in JS, but
mathematically it's `1`). Using the wrong modulo here would silently
misclassify genuine/decoy records.

Every `S` row (genuine or not) is kept in the `records` array with a
`genuine` boolean — nothing is thrown away during parsing. This is what
lets `printPerTurtleReport()` (`solve.js`) / `renderTurtleReport()`
(`index.html`) show the *full* decoy-vs-contact breakdown per turtle, not
just the final answer.

---

## 4. LOCATE

**Goal:** turn a surviving `(cequeId, realDistance)` pair into an actual
position relative to Cusco.

This stage is just a filter + lookup, done by the caller after parsing:

```js
const genuine = records.filter((r) => r.genuine);
const angle = cequeTable.get(r.cequeId); // bearing in degrees
```

`(angle, realDistance)` together are the polar coordinate of one Spanish
camp: bearing in degrees from Cusco, range in the puzzle's distance units.
No conversion to lat/long is done — the puzzle's own answer format is this
polar fix, matching the worked example in the workshop slides.

---

## 5. PLOT

**Goal:** visualize the located contacts on a radar-style polar chart.

- `polarToXY()` — `decoder.js:112`
  Converts `(angleDeg, r)` to screen `(x, y)`:
  ```js
  x = cx + r * sin(θ), y = cy - r * cos(θ)
  ```
  This puts 0° at the top (north) with angles increasing **clockwise**,
  matching the Ceque system's compass convention shown in the workshop
  slides — not the standard math convention (0° = right, counter-clockwise).

- `niceRingStep()` — `decoder.js:101`
  Picks a round ring spacing (1, 2, or 5 × a power of 10) from the max
  distance among genuine contacts, so range rings land on numbers like
  `100, 200, 300...` instead of an arbitrary fraction of the data.

- `renderPolarSVG()` — `decoder.js:119`
  The shared, plain/light-themed renderer (`opts: { size, maxR }` —
  CLI uses 900/360, tests use the defaults). Builds the SVG string:
  background, the 41 faint Ceque bearing spokes, the range rings, an origin
  marker for Cusco, and one marker + label per genuine contact. `solve.js`
  writes its output straight to `output.svg`.

- `renderRadarSVG()` — `index.html:249`
  The browser's own dark "tactical radar" variant of the same plot
  (crosshair origin, pinging `.blip-ping` contact markers, `BRG`/`RNG`
  labels). Kept local to `index.html` rather than folded into `decoder.js`
  because it depends on page-level CSS (the ping animation, glow) that
  wouldn't make sense in a standalone, environment-agnostic module — same
  reasoning as why `renderTurtleReport()`/`renderTable()` (DOM formatters)
  also stay out of `decoder.js`. It's injected via `innerHTML` alongside a
  CSS-animated `.radar-sweep` div for the rotating sweep effect.

---

## Where the webpage adds a UI layer on top

`index.html` wraps the same five stages with presentation-only code that
doesn't change the algorithm:

- `setStage()` (`index.html:363`) toggles `.active`/`.done` classes on the
  pipeline panel so each stage visibly lights up as it runs.
- The `solveBtn` click handler (`index.html:372`) calls the stages in order
  with a short `sleep()` between them — purely so the UI can reveal results
  progressively; the actual parse/decode/checksum work already finished
  inside `parseInput()` before any sleep happens.
- `renderTurtleReport()` / `renderTable()` are display-only formatters over
  `records` / `genuine` — they don't recompute anything.
- The fullscreen button (`#fullscreenBtn`) toggles the Fullscreen API on the
  `.radar-wrap` element; CSS centers it at `100vmin` on a black backdrop.

## Worked example (sample_input.csv, T3)

```
P,0,7      → Ceque_ID = 7
S,0,0,6,8,4 → Raw=684  → Real=684-7×26=502  → 502%5=2, Plastron(12)%5=2 → CONTACT
S,0,3,3,3,3 → Raw=3333 → Real=3333-182=3151 → 3151%5=1 ≠ 2            → NOISE
S,0,0,1,9,1 → Raw=191  → Real=191-182=9     → 9%5=4 ≠ 2               → NOISE
P,3,0      → Ceque_ID = 30
S,0,4,9,2,1 → Raw=4921 → Real=4921-780=4141 → 4141%5=1 ≠ 2            → NOISE
S,0,0,8,7,8 → Raw=878  → Real=878-780=98    → 98%5=3 ≠ 2              → NOISE
```

→ One confirmed contact for T3: `Ceque_ID=7, Angle=30.8°, Distance=502`.
This is the authoritative reading of `sample_input.csv` and is what
`test/decoder.test.js` asserts. (A workshop slide's worked example used
`877` instead of `878` on that last subsidiary cord, which would flip it to
a second genuine contact at `Ceque_ID=30, Angle=228°, Distance=97` — a
one-digit difference between the teaching slide and the data file, not a
bug in the decode logic.)
