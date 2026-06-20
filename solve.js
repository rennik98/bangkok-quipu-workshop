#!/usr/bin/env node
// Quiz 3 - "Quipu of Conquest" solver.
// Usage: node solve.js [inputCsv] [cequeCsv] [outSvg]

const fs = require('fs');
const path = require('path');

function trimTrailingEmpty(fields) {
  const out = fields.map((f) => f.trim());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function digitsToNumber(fields) {
  return parseInt(fields.join(''), 10);
}

function mod(n, m) {
  return ((n % m) + m) % m;
}

function parseCequeTable(cequePath) {
  const lines = fs.readFileSync(cequePath, 'utf8').trim().split(/\r?\n/);
  const table = new Map();
  for (const line of lines.slice(1)) {
    const fields = trimTrailingEmpty(line.split(','));
    if (fields.length < 2) continue;
    table.set(Number(fields[0]), Number(fields[1]));
  }
  return table;
}

function parseInput(inputPath) {
  const lines = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/);
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
      const [id, marginal, plastron] = fields;
      turtles.set(id, { marginal: Number(marginal), plastron: Number(plastron) });
    } else if (section === 'QUIPU_RECORDS') {
      if (fields.length === 1 && /^T\d+$/.test(fields[0])) {
        currentTurtle = fields[0];
        currentCequeId = null;
      } else if (fields[0] === 'P') {
        currentCequeId = digitsToNumber(fields.slice(1));
      } else if (fields[0] === 'S') {
        const rawDistance = digitsToNumber(fields.slice(1));
        const turtle = turtles.get(currentTurtle);
        const realDistance = rawDistance - currentCequeId * turtle.marginal;
        const requiredMod = turtle.plastron % 5;
        const actualMod = mod(realDistance, 5);
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

function printPerTurtleReport(turtles, records, cequeTable) {
  const byTurtle = new Map();
  for (const r of records) {
    if (!byTurtle.has(r.turtle)) byTurtle.set(r.turtle, []);
    byTurtle.get(r.turtle).push(r);
  }

  for (const [turtleId, turtleRecords] of byTurtle.entries()) {
    const t = turtles.get(turtleId);
    console.log(`\n=== ${turtleId} (Marginal=${t.marginal}, Plastron=${t.plastron}, needMod5=${t.plastron % 5}) ===`);
    for (const r of turtleRecords) {
      const verdict = r.genuine ? 'GENUINE' : 'decoy';
      const angle = r.genuine ? ` Angle=${cequeTable.get(r.cequeId)}°` : '';
      console.log(
        `  CequeID=${r.cequeId} Raw=${r.rawDistance} -> Real=${r.realDistance} (mod5=${r.actualMod}, need=${r.requiredMod}) ${verdict}${angle}`
      );
    }
    const genuineHere = turtleRecords.filter((r) => r.genuine);
    if (genuineHere.length === 0) {
      console.log('  => No genuine data from this turtle.');
    } else {
      for (const r of genuineHere) {
        console.log(`  => GENUINE: CequeID=${r.cequeId} Angle=${cequeTable.get(r.cequeId)}° Distance=${r.realDistance}`);
      }
    }
  }
}

function niceRingStep(maxVal, targetRings) {
  if (maxVal <= 0) return 1;
  const raw = maxVal / targetRings;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return nice * magnitude;
}

function polarToXY(cx, cy, angleDeg, r) {
  const theta = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}

function renderPolarSVG(records, cequeTable, outPath) {
  const size = 900;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 360;

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

  fs.writeFileSync(outPath, parts.join('\n'));
}

function main() {
  const inputPath = path.resolve(process.argv[2] || path.join(__dirname, 'sample_input.csv'));
  const cequePath = path.resolve(process.argv[3] || path.join(__dirname, 'ceque.csv'));
  const outSvgPath = path.resolve(process.argv[4] || path.join(__dirname, 'output.svg'));

  const cequeTable = parseCequeTable(cequePath);
  const { turtles, records } = parseInput(inputPath);

  printPerTurtleReport(turtles, records, cequeTable);

  const genuine = records.filter((r) => r.genuine);
  console.log('\n=== Final genuine camp locations ===');
  if (genuine.length === 0) {
    console.log('No genuine records found.');
  } else {
    for (const r of genuine) {
      const angle = cequeTable.get(r.cequeId);
      console.log(`Turtle=${r.turtle} CequeID=${r.cequeId} Angle=${angle} Distance=${r.realDistance}`);
    }
  }

  renderPolarSVG(genuine, cequeTable, outSvgPath);
  console.log(`\nPlot written to ${outSvgPath}`);
}

main();
