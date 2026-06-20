// Quipu of Conquest — shared decode/render logic.
// Pure and environment-agnostic: used by solve.js (Node CLI) and index.html (browser).

// The CSVs are exported from a fixed 6-column spreadsheet, so short rows
// (e.g. "P,2,6,,,") have empty padding fields on the right. Strip only the
// trailing empties so interior "0" digits (real knot values) are preserved.
function trimTrailingEmpty(fields) {
  const out = fields.map((f) => f.trim());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// Each knot on a cord is one digit field (e.g. ['0','0','6','8','4'] -> 684).
// Works regardless of digit count, so it survives hidden tests with wider cords.
function digitsToNumber(fields) {
  return parseInt(fields.join(''), 10);
}

// True mathematical modulo (always in [0, m)). Needed because Real_Distance
// can be negative for decoy records, and JS's % keeps the sign of n.
function mod(n, m) {
  return ((n % m) + m) % m;
}

function parseCequeTable(text) {
  const lines = text.trim().split(/\r?\n/);
  const table = new Map();
  for (const line of lines.slice(1)) {
    const fields = trimTrailingEmpty(line.split(','));
    if (fields.length < 2) continue;
    table.set(Number(fields[0]), Number(fields[1]));
  }
  return table;
}

function parseInput(text) {
  const lines = text.split(/\r?\n/);
  const turtles = new Map(); // id -> { marginal, plastron }
  const records = []; // every S row, genuine or decoy, in encounter order

  let section = null;
  let currentTurtle = null;
  let currentCequeId = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      if (line.includes('TURTLE_DATA')) section = 'TURTLE_DATA';
      else if (line.includes('QUIPU_RECORDS')) section = 'QUIPU_RECORDS';
      continue;
    }

    const fields = trimTrailingEmpty(line.split(','));
    if (fields.length === 0) continue;

    if (section === 'TURTLE_DATA') {
      // Each turtle carries its own obfuscation key (marginal scutes) and
      // checksum key (plastron scutes) used below.
      const [id, marginal, plastron] = fields;
      turtles.set(id, { marginal: Number(marginal), plastron: Number(plastron) });
    } else if (section === 'QUIPU_RECORDS') {
      if (fields.length === 1 && /^T\d+$/.test(fields[0])) {
        // "T<n>" line: switch context to a new turtle's block of cords.
        currentTurtle = fields[0];
        currentCequeId = null;
      } else if (fields[0] === 'P') {
        // Pendant (main) cord: its digits are the Ceque_ID, i.e. which of the
        // 41 fixed bearing lines the following subsidiary cords are along.
        currentCequeId = digitsToNumber(fields.slice(1));
      } else if (fields[0] === 'S') {
        // Subsidiary cord: its digits are the obfuscated Raw_Distance for one
        // candidate camp on the current pendant's bearing line.
        const rawDistance = digitsToNumber(fields.slice(1));
        const turtle = turtles.get(currentTurtle);
        // Undo the obfuscation: Raw_Distance = Ceque_ID * Marginal_Scutes + Real_Distance.
        const realDistance = rawDistance - currentCequeId * turtle.marginal;
        const requiredMod = turtle.plastron % 5;
        const actualMod = mod(realDistance, 5);
        // Checksum rule: genuine data satisfies Real_Distance % 5 == Plastron_Scutes % 5.
        // Anything else is planted decoy data and must be discarded, not just flagged.
        records.push({
          turtle: currentTurtle,
          cequeId: currentCequeId,
          rawDistance,
          realDistance,
          actualMod,
          requiredMod,
          genuine: actualMod === requiredMod,
        });
      }
    }
  }

  return { turtles, records };
}

// Pick a "nice" ring spacing (1/2/5 x 10^n) so distance rings land on round
// numbers instead of an arbitrary fraction of the max distance.
function niceRingStep(maxVal, targetRings) {
  if (maxVal <= 0) return 1;
  const raw = maxVal / targetRings;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return nice * magnitude;
}

// Polar (bearing in degrees, range) -> screen XY, with 0deg = up/north and
// angle increasing clockwise, matching the Ceque system's compass convention.
function polarToXY(cx, cy, angleDeg, r) {
  const theta = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}

// Render genuine camp locations as a polar SVG string.
// opts: { size, maxR } — CLI uses 900/360, browser uses 720/290.
function renderPolarSVG(records, cequeTable, opts = {}) {
  const size = opts.size ?? 900;
  const maxR = opts.maxR ?? 360;
  const cx = size / 2;
  const cy = size / 2;

  const maxDistance = records.length ? Math.max(...records.map((r) => r.realDistance)) : 100;
  const ringStep = niceRingStep(maxDistance, 4);
  const ringCount = Math.max(1, Math.ceil(maxDistance / ringStep));
  const topValue = ringCount * ringStep;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" font-family="sans-serif">`);
  parts.push(`<rect width="${size}" height="${size}" fill="white"/>`);

  // Faint Ceque spokes (41 fixed directions).
  for (const [id, angle] of cequeTable.entries()) {
    const p = polarToXY(cx, cy, angle, maxR);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="#ddd" stroke-width="1"/>`);
    const lp = polarToXY(cx, cy, angle, maxR + 14);
    parts.push(`<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}" font-size="8" fill="#999" text-anchor="middle">${id}:${angle}°</text>`);
  }

  // Concentric distance rings + labels (placed along the 0° spoke).
  for (let i = 1; i <= ringCount; i++) {
    const r = (i / ringCount) * maxR;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="#bbb" stroke-width="1"/>`);
    parts.push(`<text x="${cx + 4}" y="${(cy - r + 10).toFixed(1)}" font-size="10" fill="#666">${(i * ringStep).toFixed(0)}</text>`);
  }

  // Center point = Cusco.
  parts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="#333"/>`);
  parts.push(`<text x="${cx + 8}" y="${cy - 8}" font-size="11" fill="#333">Cusco</text>`);

  // Decoded genuine camp locations.
  for (const rec of records) {
    const angle = cequeTable.get(rec.cequeId);
    const r = (rec.realDistance / topValue) * maxR;
    const p = polarToXY(cx, cy, angle, r);
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="#d62728"/>`);
    parts.push(
      `<text x="${(p.x + 9).toFixed(1)}" y="${(p.y - 9).toFixed(1)}" font-size="12" fill="#d62728" font-weight="bold">${rec.turtle} CequeID=${rec.cequeId} ${angle}° r=${rec.realDistance}</text>`
    );
  }

  parts.push(`<text x="10" y="20" font-size="14" fill="#333">Decoded Spanish camp locations relative to Cusco</text>`);
  parts.push('</svg>');

  return parts.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    trimTrailingEmpty,
    digitsToNumber,
    mod,
    parseCequeTable,
    parseInput,
    niceRingStep,
    polarToXY,
    renderPolarSVG,
  };
}
