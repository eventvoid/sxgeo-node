# Benchmarks

Lookup throughput for `sxgeo-node`, measured with the reproducible script in
[`bench/bench.js`](../bench/bench.js).

Run it yourself:

```bash
npm run bench
# or point it at your own database:
node bench/bench.js path/to/SxGeoCity.dat
```

The script builds a fixed, seeded set of public IPv4 addresses (so runs are
comparable), warms up, and reports the best of three runs. Throughput is given
in operations per second — **higher is better**.

## Environment

These numbers were produced in a single session on one machine:

| | |
| --- | --- |
| Node.js | v25.1.0 |
| Platform | darwin arm64 (Apple Silicon) |
| Database | SxGeo City EN, format v22 (2024.05.16), ~37 MB |
| Sample | seeded public IPv4 addresses, best of 3 runs after warmup |

Absolute numbers depend heavily on CPU, Node version, and the database file.
Treat them as **relative** indicators, and re-run `npm run bench` on your own
hardware for figures that match your deployment.

## `0.2.0` throughput

| Mode | `getCountry` | `getCity` | `getCityFull` |
| --- | ---: | ---: | ---: |
| `FILE` | 191,021 | 147,457 | 131,652 |
| `MEMORY` | 1,454,187 | 637,218 | 462,815 |
| `MEMORY \| BATCH` | 1,962,585 | 600,961 | 492,221 |

Values are ops/sec. `MEMORY` preloads the data section; `BATCH` additionally
preloads the indexes, which mainly helps the country lookup path.

## `0.1.0` vs `0.2.0`

The same script was run against `sxgeo-node@0.1.0` installed from npm, using the
identical database and machine.

| Mode | Method | 0.1.0 (ops/s) | 0.2.0 (ops/s) | Change |
| --- | --- | ---: | ---: | ---: |
| `FILE` | `getCountry` | 35,993 | 191,021 | ~5× |
| `FILE` | `getCity` | 41,631 | 147,457 | ~3.5× |
| `FILE` | `getCityFull` | 30,661 | 131,652 | ~4× |
| `MEMORY` | `getCountry` | 69 | 1,454,187 | ~21,000× |
| `MEMORY` | `getCity` | 68 | 637,218 | ~9,400× |
| `MEMORY` | `getCityFull` | 70 | 462,815 | ~6,600× |
| `MEMORY \| BATCH` | `getCountry` | 69 | 1,962,585 | ~28,000× |
| `MEMORY \| BATCH` | `getCity` | 68 | 600,961 | ~8,800× |
| `MEMORY \| BATCH` | `getCityFull` | 68 | 492,221 | ~7,100× |

### Why the `MEMORY` numbers for 0.1.0 are so low

This is not a measurement artifact. In `0.1.0`, the in-memory read paths were
pathologically slow: every lookup in `MEMORY` / `MEMORY | BATCH` mode took on the
order of ~14 ms (≈68 ops/sec), which is **far slower than that version's own
`FILE` mode**. In other words, the "fast" mode in 0.1.0 was effectively unusable
for high throughput.

`0.2.0` reworked the in-memory lookup so that `MEMORY` mode is now the fastest
path, as intended — hence the very large ratios above. The `FILE`-mode
comparison (~3.5–5×) is the more representative "everyday" improvement, since
`FILE` mode worked correctly in both versions.

> Note: the 0.1.0 figures were collected with a smaller sample because its
> `MEMORY` mode is so slow that the full sample would take many minutes. Since
> throughput is normalized to ops/sec, the sample size does not bias the
> comparison.

## Reproducing

```bash
# current version, from the repo root:
npm run bench

# a published version, in a scratch directory:
npm install sxgeo-node@0.1.0
node -e "require('sxgeo-node')" # sanity check
# then run bench/bench.js with require('sxgeo-node') swapped in
```

You will need a Sypex Geo database file; this repository ships a fixture at
`test/SxGeoCity.dat` for development only.
