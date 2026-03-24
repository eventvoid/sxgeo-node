# sxgeo-node

`sxgeo-node` is a Node.js reader for [Sypex Geo](https://sypexgeo.net/en/) binary databases.

It works with the official `SxGeo.dat` and `SxGeoCity.dat` files and lets you resolve an IPv4 address to:

- country ISO code
- country numeric id
- city data
- region data
- full country metadata
- database metadata

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

## Quick Start

### CommonJS

```js
const path = require('node:path');
const SxGeo = require('sxgeo-node');

const dbPath = path.join(__dirname, 'data', 'SxGeoCity.dat');
const sxgeo = new SxGeo(dbPath, SxGeo.MEMORY | SxGeo.BATCH);

console.log(sxgeo.getCityFull('1.1.1.1'));
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

### `about()`

Returns metadata about the opened database:

```js
console.log(sxgeo.about());
```

Example output:

```json
{
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

## Notes

- Only IPv4 lookups are supported.
- The package reads the official Sypex Geo binary format directly.
- `SxGeoCity.dat` already contains country data, so you can use one file for full city lookups.
- If you only need country codes, `SxGeo.dat` is smaller and cheaper to load.

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```
