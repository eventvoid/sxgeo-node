'use strict';

// Reproducible micro-benchmark for sxgeo-node.
//
// Usage:
//   node bench/bench.js                      # uses test/SxGeoCity.dat
//   node bench/bench.js path/to/SxGeoCity.dat
//
// It builds a fixed pseudo-random set of public IPv4 addresses and measures
// lookup throughput (operations per second) for the main read modes and
// methods. The IP set is seeded, so runs are comparable across versions.

const path = require('node:path');
const SxGeo = require('..');

const dbFile = process.argv[2] || path.join(__dirname, '..', 'test', 'SxGeoCity.dat');

// --- Deterministic IP generator (seeded LCG, no dependencies) ------------------
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG.
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomPublicIp(rng) {
  // Avoid obvious private/reserved ranges so most lookups hit real data.
  for (;;) {
    const a = 1 + Math.floor(rng() * 223); // 1..223
    if (a === 10 || a === 127 || a === 0 || a === 169 || a === 172 || a === 192) continue;
    const b = Math.floor(rng() * 256);
    const c = Math.floor(rng() * 256);
    const d = 1 + Math.floor(rng() * 254);
    return `${a}.${b}.${c}.${d}`;
  }
}

// Sample size. Lower it (e.g. BENCH_N=30000) when profiling a slow build so a
// run finishes quickly; throughput is reported as ops/sec, so the number of
// iterations does not bias the comparison.
const N = Number(process.env.BENCH_N) || 200000;
const rng = makeRng(0xC0FFEE);
const ips = new Array(N);
for (let i = 0; i < N; i++) ips[i] = randomPublicIp(rng);

// --- Timing helper -------------------------------------------------------------
function bench(label, fn, iterations) {
  // Warm up.
  for (let i = 0; i < Math.min(iterations, 20000); i++) fn(i);

  const runs = 3;
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) fn(i);
    const ns = Number(process.hrtime.bigint() - start);
    best = Math.min(best, ns);
  }
  const opsPerSec = iterations / (best / 1e9);
  const nsPerOp = best / iterations;
  console.log(
    `  ${label.padEnd(34)} ${formatOps(opsPerSec).padStart(14)} ops/s   ${nsPerOp.toFixed(0).padStart(6)} ns/op`
  );
  return opsPerSec;
}

function formatOps(n) {
  return Math.round(n).toLocaleString('en-US');
}

// --- Scenarios -----------------------------------------------------------------
function run(modeLabel, mode) {
  console.log(`\nMode: ${modeLabel}`);
  const sxgeo = new SxGeo(dbFile, mode);
  try {
    bench('getCountry(ip)', (i) => sxgeo.getCountry(ips[i % N]), N);
    bench('getCity(ip)', (i) => sxgeo.getCity(ips[i % N]), N);
    bench('getCityFull(ip)', (i) => sxgeo.getCityFull(ips[i % N]), N);
  } finally {
    if (typeof sxgeo.close === 'function') sxgeo.close();
  }
}

console.log('sxgeo-node benchmark');
console.log('--------------------');
console.log(`node:      ${process.version}`);
console.log(`platform:  ${process.platform} ${process.arch}`);
console.log(`database:  ${dbFile}`);

const meta = (() => {
  const s = new SxGeo(dbFile, SxGeo.FILE);
  try {
    if (typeof s.about !== 'function') return 'n/a (about() unavailable in this version)';
    const a = s.about();
    return `${a.type} v${a.version} (${a.created})`;
  } finally {
    if (typeof s.close === 'function') s.close();
  }
})();
console.log(`db info:   ${meta}`);
console.log(`sample:    ${N.toLocaleString('en-US')} seeded public IPv4 addresses`);

run('FILE', SxGeo.FILE);
run('MEMORY', SxGeo.MEMORY);
run('MEMORY | BATCH', SxGeo.MEMORY | SxGeo.BATCH);

console.log('\nDone. ops/s = higher is better. Best of 3 runs after warmup.');
