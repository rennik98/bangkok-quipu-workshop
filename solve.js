#!/usr/bin/env node
// Quiz 3 - "Quipu of Conquest" solver.
// Usage: node solve.js [inputCsv] [cequeCsv] [outSvg]

const fs = require('fs');
const path = require('path');
const { parseCequeTable, parseInput, renderPolarSVG } = require('./decoder');

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

function main() {
  const inputPath = path.resolve(process.argv[2] || path.join(__dirname, 'sample_input.csv'));
  const cequePath = path.resolve(process.argv[3] || path.join(__dirname, 'ceque.csv'));
  const outSvgPath = path.resolve(process.argv[4] || path.join(__dirname, 'output.svg'));

  const cequeTable = parseCequeTable(fs.readFileSync(cequePath, 'utf8'));
  const { turtles, records } = parseInput(fs.readFileSync(inputPath, 'utf8'));

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

  fs.writeFileSync(outSvgPath, renderPolarSVG(genuine, cequeTable, { size: 900, maxR: 360 }));
  console.log(`\nPlot written to ${outSvgPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { printPerTurtleReport, main };
