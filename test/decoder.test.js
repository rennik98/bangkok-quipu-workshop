'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  trimTrailingEmpty,
  digitsToNumber,
  mod,
  parseCequeTable,
  parseInput,
  niceRingStep,
  polarToXY,
  renderPolarSVG,
} = require('../decoder');

const ROOT = path.join(__dirname, '..');
const cequeText = fs.readFileSync(path.join(ROOT, 'ceque.csv'), 'utf8');
const sampleText = fs.readFileSync(path.join(ROOT, 'sample_input.csv'), 'utf8');
const testcase2Text = fs.readFileSync(path.join(ROOT, 'testcase_2.csv'), 'utf8');

// ---------------------------------------------------------------------------
// mod(n, m)
// ---------------------------------------------------------------------------
test('mod: positive value', () => {
  assert.equal(mod(7, 5), 2);
});

test('mod: exact multiple is zero', () => {
  assert.equal(mod(10, 5), 0);
});

test('mod: zero', () => {
  assert.equal(mod(0, 5), 0);
});

test('mod: negative value wraps positive (matches sample real distances)', () => {
  assert.equal(mod(-274, 5), 1);
});

test('mod: negative exact multiple is zero', () => {
  assert.equal(mod(-755, 5), 0);
});

// ---------------------------------------------------------------------------
// digitsToNumber(fields)
// ---------------------------------------------------------------------------
test('digitsToNumber: standard digits concatenate', () => {
  assert.equal(digitsToNumber(['0', '1', '2', '3', '4']), 1234);
});

test('digitsToNumber: all zeros -> 0', () => {
  assert.equal(digitsToNumber(['0', '0', '0']), 0);
});

test('digitsToNumber: leading zeros dropped by parseInt', () => {
  assert.equal(digitsToNumber(['0', '0', '2', '7', '3']), 273);
});

test('digitsToNumber: single field', () => {
  assert.equal(digitsToNumber(['7']), 7);
});

test('digitsToNumber: multi-digit field concatenates as string', () => {
  // Documents current behavior: join('') then parseInt.
  assert.equal(digitsToNumber(['0', '12', '3']), 123);
});

test('digitsToNumber: empty array -> NaN (documented behavior)', () => {
  assert.ok(Number.isNaN(digitsToNumber([])));
});

// ---------------------------------------------------------------------------
// trimTrailingEmpty(fields)
// ---------------------------------------------------------------------------
test('trimTrailingEmpty: strips trailing empties from comma padding', () => {
  assert.deepEqual(trimTrailingEmpty(['T1', '24', '13', '', '', '']), ['T1', '24', '13']);
});

test('trimTrailingEmpty: trims surrounding whitespace', () => {
  assert.deepEqual(trimTrailingEmpty([' T1 ', ' 24 ']), ['T1', '24']);
});

test('trimTrailingEmpty: all-empty collapses to []', () => {
  assert.deepEqual(trimTrailingEmpty(['', '']), []);
});

test('trimTrailingEmpty: no trailing empties returned unchanged', () => {
  assert.deepEqual(trimTrailingEmpty(['P', '2', '6']), ['P', '2', '6']);
});

test('trimTrailingEmpty: internal empties preserved', () => {
  assert.deepEqual(trimTrailingEmpty(['a', '', 'b']), ['a', '', 'b']);
});

// ---------------------------------------------------------------------------
// parseCequeTable(text)
// ---------------------------------------------------------------------------
test('parseCequeTable: full table has 41 entries', () => {
  const table = parseCequeTable(cequeText);
  assert.equal(table.size, 41);
});

test('parseCequeTable: numeric keys map to angles', () => {
  const table = parseCequeTable(cequeText);
  assert.equal(table.get(7), 30.8);
  assert.equal(table.get(4), 0);
  assert.equal(table.get(24), 180);
});

test('parseCequeTable: header row skipped, keys are Numbers not strings', () => {
  const table = parseCequeTable(cequeText);
  assert.equal(table.get('7'), undefined);
  assert.equal(table.get(7), 30.8);
});

test('parseCequeTable: tolerates trailing commas and CRLF', () => {
  const table = parseCequeTable('ID,Angle\r\n1,320.5,,\r\n2,335,\r\n');
  assert.equal(table.size, 2);
  assert.equal(table.get(1), 320.5);
  assert.equal(table.get(2), 335);
});

// ---------------------------------------------------------------------------
// parseInput(text)
// ---------------------------------------------------------------------------
test('parseInput: turtle data stored as numbers', () => {
  const { turtles } = parseInput(sampleText);
  assert.deepEqual(turtles.get('T1'), { marginal: 24, plastron: 13 });
  assert.deepEqual(turtles.get('T2'), { marginal: 22, plastron: 11 });
  assert.deepEqual(turtles.get('T3'), { marginal: 26, plastron: 12 });
});

test('parseInput: realDistance = raw - cequeId*marginal and required mod', () => {
  const { records } = parseInput(sampleText);
  const first = records[0]; // T1, ceque 26, raw 1234
  assert.equal(first.turtle, 'T1');
  assert.equal(first.cequeId, 26);
  assert.equal(first.rawDistance, 1234);
  assert.equal(first.realDistance, 1234 - 26 * 24); // 610
  assert.equal(first.requiredMod, 13 % 5); // 3
  assert.equal(first.actualMod, mod(610, 5)); // 0
  assert.equal(first.genuine, false);
});

test('parseInput: sample yields exactly the two T3 genuine records', () => {
  const { records } = parseInput(sampleText);
  const genuine = records.filter((r) => r.genuine).map((r) => ({
    turtle: r.turtle,
    cequeId: r.cequeId,
    realDistance: r.realDistance,
  }));
  assert.deepEqual(genuine, [
    { turtle: 'T3', cequeId: 7, realDistance: 502 },
    { turtle: 'T3', cequeId: 30, realDistance: 97 },
  ]);
});

test('parseInput: T1 and T2 in sample are decoy-only', () => {
  const { records } = parseInput(sampleText);
  const t1 = records.filter((r) => r.turtle === 'T1');
  const t2 = records.filter((r) => r.turtle === 'T2');
  assert.ok(t1.length > 0 && t1.every((r) => !r.genuine));
  assert.ok(t2.length > 0 && t2.every((r) => !r.genuine));
});

test('parseInput: negative real distance still classified', () => {
  const { records } = parseInput(sampleText);
  // T1, ceque 26, raw 350 -> 350 - 624 = -274, mod5 = 1, need 3 => decoy
  const neg = records.find((r) => r.rawDistance === 350);
  assert.equal(neg.realDistance, -274);
  assert.equal(neg.actualMod, 1);
  assert.equal(neg.genuine, false);
});

test('parseInput: testcase_2 yields the exact genuine set', () => {
  const { records } = parseInput(testcase2Text);
  const genuine = records.filter((r) => r.genuine).map((r) => ({
    turtle: r.turtle,
    cequeId: r.cequeId,
    realDistance: r.realDistance,
  }));
  assert.deepEqual(genuine, [
    { turtle: 'T1', cequeId: 10, realDistance: 123 },
    { turtle: 'T1', cequeId: 24, realDistance: 58 },
    { turtle: 'T2', cequeId: 15, realDistance: 204 },
    { turtle: 'T2', cequeId: 33, realDistance: 9 },
  ]);
});

test('parseInput: record order preserved (encounter order)', () => {
  const { records } = parseInput(testcase2Text);
  // First two records belong to T1 under ceque 10, next two under ceque 24.
  assert.equal(records[0].cequeId, 10);
  assert.equal(records[1].cequeId, 10);
  assert.equal(records[2].cequeId, 24);
  assert.equal(records[3].cequeId, 24);
});

test('parseInput: multiple P under one turtle switches cequeId', () => {
  const text = [
    '# TURTLE_DATA',
    'T1,10,5',
    '# QUIPU_RECORDS',
    'T1',
    'P,0,1',
    'S,0,0,1,5', // raw 15, real 15-10=5, mod 0, need 0 -> genuine
    'P,0,2',
    'S,0,0,2,5', // raw 25, real 25-20=5, mod 0, need 0 -> genuine
  ].join('\n');
  const { records } = parseInput(text);
  assert.equal(records[0].cequeId, 1);
  assert.equal(records[1].cequeId, 2);
});

test('parseInput: blank lines and CRLF tolerated', () => {
  const text = '# TURTLE_DATA\r\n\r\nT1,10,5\r\n\r\n# QUIPU_RECORDS\r\nT1\r\nP,0,1\r\nS,0,0,1,5\r\n';
  const { turtles, records } = parseInput(text);
  assert.equal(turtles.size, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].realDistance, 5);
});

test('parseInput: P-row leading zeros parse to the ceque id', () => {
  const text = ['# TURTLE_DATA', 'T1,10,5', '# QUIPU_RECORDS', 'T1', 'P,0,7', 'S,0,0,7,5'].join('\n');
  const { records } = parseInput(text);
  assert.equal(records[0].cequeId, 7);
});

// Degenerate cases: assert *current* behavior so future changes are visible.
test('parseInput: S row before any P treats cequeId as null (current behavior)', () => {
  const text = ['# TURTLE_DATA', 'T1,10,5', '# QUIPU_RECORDS', 'T1', 'S,0,0,2,0'].join('\n');
  const { records } = parseInput(text);
  // currentCequeId is null -> null * marginal === 0, so realDistance === rawDistance.
  assert.equal(records[0].cequeId, null);
  assert.equal(records[0].realDistance, 20);
});

test('parseInput: record for unknown turtle currently throws', () => {
  const text = ['# TURTLE_DATA', 'T1,10,5', '# QUIPU_RECORDS', 'T9', 'P,0,1', 'S,0,0,1,5'].join('\n');
  assert.throws(() => parseInput(text), TypeError);
});

// ---------------------------------------------------------------------------
// niceRingStep(maxVal, targetRings)
// ---------------------------------------------------------------------------
test('niceRingStep: non-positive max guarded to 1', () => {
  assert.equal(niceRingStep(0, 4), 1);
  assert.equal(niceRingStep(-50, 4), 1);
});

test('niceRingStep: matches output.svg for sample (502 -> step 100)', () => {
  assert.equal(niceRingStep(502, 4), 100);
});

test('niceRingStep: 204 -> step 50', () => {
  assert.equal(niceRingStep(204, 4), 50);
});

test('niceRingStep: residual boundaries pick 1/2/5/10 buckets', () => {
  assert.equal(niceRingStep(4, 4), 1); // residual 1.0 -> 1
  assert.equal(niceRingStep(6, 4), 2); // residual 1.5 -> 2
  assert.equal(niceRingStep(12, 4), 5); // residual 3.0 -> 5
  assert.equal(niceRingStep(28, 4), 10); // residual 7.0 -> 10
});

test('niceRingStep: sub-1 values produce fractional steps', () => {
  assert.equal(niceRingStep(0.4, 4), 0.1);
});

// ---------------------------------------------------------------------------
// polarToXY(cx, cy, angleDeg, r)
// ---------------------------------------------------------------------------
function approx(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} !~= ${expected}`);
}

test('polarToXY: 0 degrees points straight up', () => {
  const p = polarToXY(450, 450, 0, 100);
  approx(p.x, 450);
  approx(p.y, 350);
});

test('polarToXY: 90 degrees points right', () => {
  const p = polarToXY(450, 450, 90, 100);
  approx(p.x, 550);
  approx(p.y, 450);
});

test('polarToXY: 180 degrees points down', () => {
  const p = polarToXY(450, 450, 180, 100);
  approx(p.x, 450);
  approx(p.y, 550);
});

test('polarToXY: 270 degrees points left', () => {
  const p = polarToXY(450, 450, 270, 100);
  approx(p.x, 350);
  approx(p.y, 450);
});

test('polarToXY: matches output.svg spoke for ceque 7 @ 30.8 deg, r=360', () => {
  const p = polarToXY(450, 450, 30.8, 360);
  // output.svg line endpoint for ceque 7: x2=634.3 y2=140.8
  approx(p.x, 634.3, 0.05);
  approx(p.y, 140.8, 0.05);
});

// ---------------------------------------------------------------------------
// renderPolarSVG(records, cequeTable, opts)
// ---------------------------------------------------------------------------
test('renderPolarSVG: empty records still produces a valid SVG', () => {
  const table = parseCequeTable(cequeText);
  const svg = renderPolarSVG([], table);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('Cusco'));
  assert.ok(svg.includes('</svg>'));
  // No camp markers when there are no genuine records.
  assert.equal((svg.match(/fill="#d62728"/g) || []).length, 0);
});

test('renderPolarSVG: one marker per genuine record', () => {
  const table = parseCequeTable(cequeText);
  const { records } = parseInput(testcase2Text);
  const genuine = records.filter((r) => r.genuine);
  const svg = renderPolarSVG(genuine, table);
  // Each marker is a filled circle; labels reuse the same colour, so count circles.
  const markers = (svg.match(/<circle[^>]*fill="#d62728"/g) || []).length;
  assert.equal(markers, genuine.length);
});

test('renderPolarSVG: honors opts.size', () => {
  const table = parseCequeTable(cequeText);
  const svg = renderPolarSVG([], table, { size: 720, maxR: 290 });
  assert.ok(svg.includes('width="720" height="720"'));
});

// ---------------------------------------------------------------------------
// Integration: solve.js CLI
// ---------------------------------------------------------------------------
function runCli(args) {
  return execFileSync('node', [path.join(ROOT, 'solve.js'), ...args], { encoding: 'utf8' });
}

function tmpSvg() {
  return path.join(os.tmpdir(), `quipu-test-${process.pid}-${Math.random().toString(36).slice(2)}.svg`);
}

test('CLI: sample input reports the two genuine camps and writes an SVG', () => {
  const out = tmpSvg();
  try {
    const stdout = runCli([path.join(ROOT, 'sample_input.csv'), path.join(ROOT, 'ceque.csv'), out]);
    assert.ok(stdout.includes('GENUINE: CequeID=7 Angle=30.8° Distance=502'));
    const finalLines = stdout.split('\n').filter((l) => l.startsWith('Turtle='));
    assert.deepEqual(finalLines, [
      'Turtle=T3 CequeID=7 Angle=30.8 Distance=502',
      'Turtle=T3 CequeID=30 Angle=228 Distance=97',
    ]);
    assert.ok(fs.readFileSync(out, 'utf8').startsWith('<svg'));
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('CLI: testcase_2 reports exactly four genuine camps', () => {
  const out = tmpSvg();
  try {
    const stdout = runCli([path.join(ROOT, 'testcase_2.csv'), path.join(ROOT, 'ceque.csv'), out]);
    const finalLines = stdout.split('\n').filter((l) => l.startsWith('Turtle='));
    assert.deepEqual(finalLines, [
      'Turtle=T1 CequeID=10 Angle=55 Distance=123',
      'Turtle=T1 CequeID=24 Angle=180 Distance=58',
      'Turtle=T2 CequeID=15 Angle=105 Distance=204',
      'Turtle=T2 CequeID=33 Angle=248.8 Distance=9',
    ]);
  } finally {
    fs.rmSync(out, { force: true });
  }
});

test('CLI: no-genuine input prints the empty message and still writes an SVG', () => {
  const out = tmpSvg();
  const inp = path.join(os.tmpdir(), `quipu-nogenuine-${process.pid}.csv`);
  // T1 plastron needs mod 1; craft a record whose real distance is mod 0.
  fs.writeFileSync(inp, ['# TURTLE_DATA', 'T1,10,11', '# QUIPU_RECORDS', 'T1', 'P,0,1', 'S,0,0,2,0'].join('\n'));
  try {
    const stdout = runCli([inp, path.join(ROOT, 'ceque.csv'), out]);
    assert.ok(stdout.includes('No genuine records found.'));
    assert.ok(fs.readFileSync(out, 'utf8').startsWith('<svg'));
  } finally {
    fs.rmSync(out, { force: true });
    fs.rmSync(inp, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Drift guard: index.html must use the shared module, not its own copies.
// ---------------------------------------------------------------------------
test('index.html loads decoder.js and no longer redefines shared functions', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="decoder.js"></script>'));
  assert.ok(!/function\s+parseInput\s*\(/.test(html));
  assert.ok(!/function\s+digitsToNumber\s*\(/.test(html));
});
