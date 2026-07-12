# sxgeo-node

[![license](https://img.shields.io/npm/l/sxgeo-node?color=blue)](https://github.com/eventvoid/sxgeo-node/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/sxgeo-node?color=blue)](https://www.npmjs.com/package/sxgeo-node)
[![CI](https://github.com/eventvoid/sxgeo-node/actions/workflows/ci.yml/badge.svg)](https://github.com/eventvoid/sxgeo-node/actions/workflows/ci.yml)

`sxgeo-node` is a fast, dependency-free Node.js reader for [Sypex Geo](https://sypexgeo.net/en/) binary databases. Its API and mode flags follow the official Sypex Geo API.

It works with the official `SxGeo.dat` and `SxGeoCity.dat` files and lets you resolve an IPv4 address to:

- country ISO code
- country numeric id
- city data
- region data
- full country metadata
- database metadata

Highlights:

- no runtime dependencies or network access
- FILE, MEMORY, and BATCH modes compatible with the official API
- CommonJS, native ESM interoperability, and bundled TypeScript declarations
- UTF-8, Latin-1, and CP1251 database support
- bounded lookup caches, batch helpers, and optional shared memory images

Requires Node.js 20 or newer.

## Installation

```bash
npm install sxgeo-node
```

## Download a Database

This package does not bundle a database file.

Download one from the official Sypex Geo website and place it somewhere in your project:

- country database: `SxGeo.dat`
- city database: `SxGeoCity.dat`

Example:

```text
your-project/
  data/
    SxGeoCity.dat
  index.js
```

Database acquisition and scheduled updates are intentionally outside this package. Use the official Sypex Geo downloads and updater, your deployment pipeline, cron, or another system-level mechanism. `sxgeo-node` performs no network requests.

## Quick Start

### CommonJS

```js
const path = require('node:path');
const SxGeo = require('sxgeo-node');

const dbPath = path.join(__dirname, 'data', 'SxGeoCity.dat');
const sxgeo = new SxGeo(dbPath, SxGeo.MEMORY | SxGeo.BATCH);

console.log(sxgeo.getCityFull('1.1.1.1'));
sxgeo.close();
```

### Native ESM

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SxGeo from 'sxgeo-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'SxGeoCity.dat');
const sxgeo = new SxGeo(dbPath, SxGeo.MEMORY | SxGeo.BATCH);

console.log(sxgeo.getCityFull('1.1.1.1'));
sxgeo.close();
```

Example output:

```json
{
  "city": {
    "id": 2174003,
    "lat": -27.46794,
    "lon": 153.02809,
    "name_ru": "Брисбен",
    "name_en": "Brisbane"
  },
  "region": {
    "id": 2152274,
    "name_ru": "Квинсленд",
    "name_en": "State of Queensland",
    "iso": "AU-QLD"
  },
  "country": {
    "id": 16,
    "iso": "AU",
    "lat": -25,
    "lon": 135,
    "name_ru": "Австралия",
    "name_en": "Australia"
  }
}
```

## Constructor

```js
const sxgeo = new SxGeo(databasePath, mode);
```

Arguments:

- `databasePath`: absolute or relative path to `SxGeo.dat` or `SxGeoCity.dat`
- `mode`: optional bitmask of read modes

Available mode flags:

- `SxGeo.FILE`: read from the file on demand
- `SxGeo.MEMORY`: preload the data section into memory
- `SxGeo.BATCH`: preload indexes for faster repeated lookups

Recommended mode for high-throughput usage:

```js
const sxgeo = new SxGeo(dbPath, SxGeo.MEMORY | SxGeo.BATCH);
```

Recommended mode for low-memory usage:

```js
const sxgeo = new SxGeo(dbPath, SxGeo.FILE);
```

## API

### `get(ip)`

Returns:

- `getCity(ip)` output when the city database is used
- `getCountry(ip)` output when the country database is used

All lookup methods return `false` when an address is invalid, private, unsupported, or absent from the database.

### `getCountry(ip)`

Returns a two-letter ISO country code.

```js
sxgeo.getCountry('8.8.8.8');
// "US"
```

### `getCountryId(ip)`

Returns the numeric country id from the Sypex Geo database.

```js
sxgeo.getCountryId('8.8.8.8');
// 225
```

### `getCity(ip)`

Returns a short city result:

```json
{
  "city": {
    "id": 2174003,
    "lat": -27.46794,
    "lon": 153.02809,
    "name_ru": "Брисбен",
    "name_en": "Brisbane"
  },
  "country": {
    "id": 16,
    "iso": "AU"
  }
}
```

### `getCityFull(ip)`

Returns city, region, and full country data.

Use this method when you need country coordinates, localized names, or region details.

### Batch lookups

Batch helpers preserve input order and use the same lookup caches and read modes:

```js
sxgeo.getMany(ips);
sxgeo.getCountryMany(ips);
sxgeo.getCityMany(ips);
sxgeo.getCityMany(ips, true); // full city, region, and country
```

### `getDbVersion()` / `getDbDate()`

Return the binary format version and database compilation date.

### `about()`

Returns metadata about the opened database:

```js
console.log(sxgeo.about());
```

Example output:

```json
{
  "version": 22,
  "created": "2026.01.19",
  "timestamp": 1768861974,
  "charset": "utf-8",
  "type": "SxGeo City EN",
  "byteIndex": 224,
  "mainIndex": 1775,
  "blocksInIndexItem": 3376,
  "ipBlocks": 5995209,
  "blockSize": 6,
  "city": {
    "maxLength": 127,
    "totalSize": 2687625
  },
  "region": {
    "maxLength": 175,
    "totalSize": 109649
  },
  "country": {
    "maxLength": 147,
    "totalSize": 9387
  }
}
```

### `close()`

Closes the underlying database file descriptor. Calling it more than once is safe. Further lookups throw an error.

```js
sxgeo.close();
```

On runtimes with explicit resource management, the class also supports `Symbol.dispose`.

### `clearCache()`

Country and city records use bounded caches of up to 4096 entries for repeated lookups. Returned records are copied, so caller mutations do not corrupt cached values. Long-running applications can clear both caches explicitly:

```js
sxgeo.clearCache();
```

### Shared memory image

Multiple readers for the same unchanged database can share one read-only file image. The first instance loads the file; subsequent live instances avoid another disk read and do not duplicate the full database buffer:

```js
const primary = SxGeo.openShared(dbPath);
const secondary = SxGeo.openShared(dbPath);
```

The cache key includes the canonical path, size, and modification time. It uses `WeakRef`, so the shared image can be garbage-collected after no reader references it.

## Notes

- Only IPv4 lookups are supported.
- Invalid, private, and unsupported IPv4 addresses return `false`, matching the official API style.
- The package reads the official Sypex Geo 2.2 binary format directly, including arbitrary directory fields.
- UTF-8, Latin-1, and CP1251 database strings are decoded according to the database header.
- Country, City, and Max binary databases are supported. Max-only fields such as timezone, continent, and regional coordinates are preserved automatically from the database schema.
- `SxGeo_Info` is not a lookup database: it is a separate TSV/SQL directory export and is intentionally not accepted by `SxGeo`.
- `SxGeoCity.dat` already contains country data, so you can use one file for full city lookups.
- If you only need country codes, `SxGeo.dat` is smaller and cheaper to load.

## Benchmarks

In `MEMORY | BATCH` mode, `0.2.0` resolves roughly **1.9M** country lookups and
**600K** full-city lookups per second on Apple Silicon, and is dramatically
faster than `0.1.0` (whose in-memory mode was orders of magnitude slower).

Full results, methodology, and a `0.1.0` vs `0.2.0` comparison are in
[docs/BENCHMARKS.md](https://github.com/eventvoid/sxgeo-node/blob/main/docs/BENCHMARKS.md).
Reproduce them with `npm run bench`.

## Compatibility matrix

| Sypex Geo download | Support | Notes |
| --- | --- | --- |
| `SxGeoCountry.zip` | Full reader support | Download and updates are external |
| `SxGeoCity_utf8.zip` | Full reader support | Download and updates are external |
| `SxGeoCity_cp1251.zip` | Full reader support | Strings are decoded from CP1251 |
| SxGeo Max | Format support | All fields embedded in the database schema are preserved |
| Custom SxGeo 2.2 databases | Reader support | Arbitrary directory fields described by the embedded pack schema are decoded |
| `SxGeo_Info.zip` | Not applicable | TSV/SQL reference directories, not an IP lookup database |
| Sypex Geo REST API | Separate service | This package performs local, offline database lookups |
| IPv6 | Not supported | The SxGeo 2.2 local database format and official PHP reader use IPv4 |

## License and upstream

The Sypex Geo format and original API are maintained by Sypex Geo. This Node.js implementation follows their documented API and file format. The code is distributed under the BSD 3-Clause License; database files remain subject to the terms published by Sypex Geo.

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

The integration fixture is used only for development and is excluded from the npm package.
