// Replays every solution in the fixture files through two engines and requires
// identical results:
//   1. the current game page (client/lightyard-79.html) running in a simulated browser
//   2. the extracted rules in src/core.js, as the server will run them
// Usage: npm test [fixture.json ...]   (default: every .json under test/fixtures)
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { normalizePuzzle, normalizeSolution, runSolution, pieceCounts, InvalidSubmission } from '../src/check.js';
import { RULES_VERSION } from '../src/core.js';

const MAX_TICKS = 20000; // keeps runaway solutions from dominating test time

function loadPage(version) {
  let html = fs.readFileSync('client/lightyard-79.html', 'utf8');
  const hook = `window.__LY={State,doTick,finishRun,finishFailureScene,buildWorkingGrid,quiet(){onRunFinished=function(){};}};\n})();\n</script></body></html>`;
  html = html.slice(0, html.lastIndexOf('})();')) + hook;
  const noop = new Proxy(function () {}, { get: (t, k) => k === 'canvas' ? { width: 0, height: 0 } : k === 'measureText' ? () => ({ width: 0 }) : noop, apply: () => noop, set: () => true });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://www.geoffcanyon.com/lightyard.html', virtualConsole: new VirtualConsole(), pretendToBeVisual: true,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = () => noop; w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }); w.alert = () => {}; },
  });
  const L = dom.window.__LY; L.quiet(); return L;
}

function runInPage(L, puzzle, solution) {
  const S = L.State, clone = x => JSON.parse(JSON.stringify(x));
  const p = clone(puzzle), s = clone(solution);
  S.puzzles = [p]; S.solutions = [s]; S.currentPuzzleId = p.id; S.currentSolutionId = s.id;
  S.screen = 'solutionEdit'; S.gridRows = p.rows; S.gridCols = p.cols;
  L.buildWorkingGrid();
  while (!S.finished) {
    if (S.tick >= MAX_TICKS) return { outcome: 'stopped', ticks: S.tick };
    L.doTick();
    if (S.failureScene) { L.finishFailureScene(); break; }
    if (S.finishAfterAnimation) { S.finishAfterAnimation = false; L.finishRun(); }
  }
  return { outcome: S.solved ? 'solved' : 'failed', ticks: S.tick, failure: S.solved ? null : (S.firstFailure && S.firstFailure.message) || 'not solved' };
}

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync('test/fixtures', { recursive: true }).filter(f => f.endsWith('.json')).map(f => path.join('test/fixtures', f));
if (!files.length) { console.error('No replay fixtures found under test/fixtures'); process.exit(1); }

const page = loadPage(RULES_VERSION);
let total = 0, same = 0, rejected = 0, recorded = 0, recordedMatch = 0;
const diffs = [];
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const puzzles = new Map();
  for (const set of data.sets || []) for (const p of set.puzzles || []) puzzles.set(p.id, p);
  for (const raw of data.solutions || []) {
    const rawPuzzle = puzzles.get(raw.puzzleId);
    if (!rawPuzzle) continue;
    total++;
    let puzzle, solution;
    try { puzzle = normalizePuzzle(rawPuzzle); solution = normalizeSolution(puzzle, raw); }
    catch (e) { if (e instanceof InvalidSubmission) { rejected++; continue; } throw e; }
    const server = runSolution(puzzle, solution, { maxTicks: MAX_TICKS });
    const game = runInPage(page, puzzle, solution);
    const a = JSON.stringify([server.outcome, server.ticks, server.failure ?? null]);
    const b = JSON.stringify([game.outcome, game.ticks, game.failure ?? null]);
    if (a === b) same++; else diffs.push({ file, solution: raw.name, puzzle: rawPuzzle.name, server, game });
    if (raw.status === 'solved' && raw.ticksToSolve != null) {
      recorded++;
      if (server.outcome === 'solved' && server.ticks === raw.ticksToSolve && pieceCounts(solution).elements === raw.elements.length) recordedMatch++;
      else diffs.push({ file, solution: raw.name, puzzle: rawPuzzle.name, note: `recorded ${raw.ticksToSolve} ticks`, server });
    }
  }
}
console.log(`${RULES_VERSION}: ${total} solutions | ${same} identical in game and server | ${rejected} rejected as invalid uploads | ${recordedMatch}/${recorded} recorded solves reproduced exactly`);
for (const d of diffs) console.log('DIFF', JSON.stringify(d));
process.exit(diffs.length ? 1 : 0);
