const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SxGeo = require('../dist/sxgeo');

const dbPath = path.join(__dirname, 'SxGeoCity.dat');
const modes = [
    SxGeo.FILE,
    SxGeo.MEMORY,
    SxGeo.BATCH,
    SxGeo.MEMORY | SxGeo.BATCH
];

assert.equal(typeof SxGeo, 'function');
assert.equal(SxGeo.MODES.FILE, SxGeo.FILE);
assert.equal(SxGeo.MODES.MEMORY, SxGeo.MEMORY);
assert.equal(SxGeo.MODES.BATCH, SxGeo.BATCH);

for (const mode of modes) {
    const geo = new SxGeo(dbPath, mode);
    const au = geo.getCityFull('1.1.1.1');
    const us = geo.getCityFull('8.8.8.8');
    const ie = geo.getCityFull('31.13.64.1');

    assert.equal(geo.getCountry('77.88.8.8'), 'RU');
    assert.equal(geo.getCountryId('1.1.1.1'), 16);
    assert.equal(geo.getCity('127.0.0.1'), false);

    assert.equal(au.country.iso, 'AU');
    assert.equal(au.country.lat, -25);
    assert.equal(au.country.lon, 135);

    assert.equal(us.country.iso, 'US');
    assert.equal(us.country.lon, -98.5);

    assert.equal(ie.country.iso, 'IE');
    assert.equal(ie.country.lon, -8);
}

const esmCheck = spawnSync(
    process.execPath,
    [
        '--input-type=module',
        '-e',
        `import SxGeo from ${JSON.stringify(path.join(__dirname, '..', 'dist', 'sxgeo.js'))};
         const geo = new SxGeo(${JSON.stringify(dbPath)}, SxGeo.MEMORY | SxGeo.BATCH);
         console.log(geo.getCountry('8.8.8.8'));`
    ],
    { encoding: 'utf8' }
);

assert.equal(esmCheck.status, 0, esmCheck.stderr);
assert.equal(esmCheck.stdout.trim(), 'US');

console.log('All tests passed.');
