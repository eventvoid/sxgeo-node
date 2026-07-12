import * as fs from 'node:fs';

function parseIpv4(ip: string): number | false {
    if (ip.length < 7 || ip.length > 15) return false;

    let result = 0;
    let octet = 0;
    let value = 0;
    let digits = 0;

    for (let index = 0; index <= ip.length; index++) {
        const code = index === ip.length ? 46 : ip.charCodeAt(index);
        if (code === 46) {
            if (digits === 0 || value > 255 || octet > 3) return false;
            result = (result * 256 + value) >>> 0;
            octet++;
            value = 0;
            digits = 0;
            continue;
        }
        if (code < 48 || code > 57 || digits === 3) return false;
        if (digits === 0 && code === 48 && index + 1 < ip.length && ip.charCodeAt(index + 1) !== 46) return false;
        value = value * 10 + code - 48;
        digits++;
    }

    return octet === 4 ? result >>> 0 : false;
}

function unpackString(buffer: Buffer): number[] {
    const result: number[] = [];

    for (let i = 0; i < buffer.length; i += 4) {
        const value = buffer.readUInt32BE(i);
        result.push(value);
    }

    return result;
}

function readChunk(fd: number, length: number, position: number): Buffer {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, position);

    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

const SXGEO_FILE = 0;
const SXGEO_MEMORY = 1;
const SXGEO_BATCH = 2;

interface AboutInfo {
    version: number;
    created: string;
    timestamp: number;
    charset: string;
    type: string;
    byteIndex: number;
    mainIndex: number;
    blocksInIndexItem: number;
    ipBlocks: number;
    blockSize: number;
    city: {
        maxLength: number;
        totalSize: number;
    };
    region: {
        maxLength: number;
        totalSize: number;
    };
    country: {
        maxLength: number;
        totalSize: number;
    };
}

interface Info {
    ver: number;
    time: number;
    type: number;
    charset: number;
    b_idx_len: number;
    m_idx_len: number;
    range: number;
    db_items: number;
    id_len: number;
    max_region: number;
    max_city: number;
    region_size: number;
    city_size: number;
    max_country: number;
    country_size: number;
    pack_size: number;
    regions_begin?: number;
    cities_begin?: number;
};

interface FieldSpec {
    type: string;
    name: string;
    width: number;
    scale: number;
}

function compileFormat(format: string): FieldSpec[] {
    return format.split('/').map((part) => {
        const separator = part.indexOf(':');
        const type = separator === -1 ? part : part.slice(0, separator);
        const name = separator === -1 ? '' : part.slice(separator + 1);
        const kind = type.charAt(0);
        let width = 4;

        if (kind === 't' || kind === 'T') width = 1;
        else if (kind === 's' || kind === 'S' || kind === 'n') width = 2;
        else if (kind === 'm' || kind === 'M') width = 3;
        else if (kind === 'd') width = 8;
        else if (kind === 'c') width = Number.parseInt(type.slice(1), 10);
        else if (kind === 'b') width = -1;

        const precision = kind === 'n' || kind === 'N' ? Number.parseInt(type.slice(1), 10) : 0;
        return { type: kind, name, width, scale: 10 ** (Number.isNaN(precision) ? 0 : precision) };
    }).filter((field) => field.name.length > 0);
}

class SxGeo {
    private static readonly sharedImages = new Map<string, WeakRef<Buffer>>();
    static readonly FILE = SXGEO_FILE;
    static readonly MEMORY = SXGEO_MEMORY;
    static readonly BATCH = SXGEO_BATCH;
    static readonly MODES = {
        FILE: SXGEO_FILE,
        MEMORY: SXGEO_MEMORY,
        BATCH: SXGEO_BATCH
    } as const;
    /** Open a memory-mode reader that can share one read-only file image with other instances. */
    static openShared(dbFile = 'SxGeo.dat', type = SXGEO_MEMORY | SXGEO_BATCH): SxGeo {
        return new SxGeo(dbFile, type | SXGEO_MEMORY, true);
    }

    private fh: number;
    private range: number;
    private b_idx_len: number;
    private m_idx_len: number;
    private db_items: number;
    private id_len: number;
    private block_len: number;
    private max_region: number;
    private max_city: number;
    private max_country: number;
    private country_size: number;
    /** Whether the BATCH index mode is enabled (official API compatibility). */
    batch_mode = false;
    /** Whether the database image is loaded into memory (official API compatibility). */
    memory_mode = false;
    private pack: string[] = [];
    private b_idx_str: Buffer = Buffer.alloc(0);
    private m_idx_str: Buffer = Buffer.alloc(0);
    private info!: Info;
    private db_begin: number;
    private b_idx_arr: number[] = [];
    private m_idx_arr: number[] = [];
    private db: Buffer = Buffer.alloc(0);
    private regions_db: Buffer = Buffer.alloc(0);
    private cities_db: Buffer = Buffer.alloc(0);
    private closed = false;
    private readonly decoder: TextDecoder;
    private readonly countryCache = new Map<number, { id: number; iso: string }>();
    private readonly cityCache = new Map<number, { short?: SxGeo.CityResult; full?: SxGeo.CityFullResult }>();
    private readonly formats = new Map<string, readonly FieldSpec[]>();

    readonly id2iso: readonly string[] = ['', 'AP', 'EU', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'CW', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU',
        'AW', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BM', 'BN', 'BO', 'BR', 'BS',
        'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
        'CO', 'CR', 'CU', 'CV', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG',
        'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'SX', 'GA', 'GB', 'GD', 'GE', 'GF',
        'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN',
        'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE',
        'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR',
        'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP',
        'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI',
        'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN',
        'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG',
        'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'ST', 'SV', 'SY', 'SZ', 'TC', 'TD', 'TF',
        'TG', 'TH', 'TJ', 'TK', 'TM', 'TN', 'TO', 'TL', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM',
        'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'RS', 'ZA',
        'ZM', 'ME', 'ZW', 'A1', 'XK', 'O1', 'AX', 'GG', 'IM', 'JE', 'BL', 'MF', 'BQ', 'SS'
    ];
    /** @deprecated Use the official `id2iso` name. Kept for sxgeo-node 0.1 compatibility. */
    readonly ip2iso = this.id2iso;
    constructor(dbFile = 'SxGeo.dat', type = SXGEO_FILE, shared = false) {
        if (!fs.existsSync(dbFile)) {
            throw new Error("Can't open file");
        }

        let memoryImage: Buffer | undefined;
        if ((type & SXGEO_MEMORY) !== 0) {
            if (shared) {
                const resolved = fs.realpathSync(dbFile);
                const stat = fs.statSync(resolved);
                const cacheKey = `${resolved}\0${stat.size}\0${stat.mtimeMs}`;
                memoryImage = SxGeo.sharedImages.get(cacheKey)?.deref();
                if (!memoryImage) {
                    memoryImage = fs.readFileSync(resolved);
                    SxGeo.sharedImages.set(cacheKey, new WeakRef(memoryImage));
                }
            } else {
                memoryImage = fs.readFileSync(dbFile);
            }
        }
        this.fh = memoryImage ? -1 : fs.openSync(dbFile, 'r');

        const header = memoryImage ? memoryImage.subarray(0, 40) : readChunk(this.fh, 40, 0);
        if (header.length !== 40 || header.toString('utf8', 0, 3) !== 'SxG') {
            if (this.fh >= 0) fs.closeSync(this.fh);
            throw new Error(`Can't open ${dbFile}`);
        }
        
        const offset = 3;

        const info = {
            ver: header.readUInt8(offset),
            time: header.readUInt32BE(offset + 1),
            type: header.readUInt8(offset + 5),
            charset: header.readUInt8(offset + 6),
            b_idx_len: header.readUInt8(offset + 7),
            m_idx_len: header.readUInt16BE(offset + 8),
            range: header.readUInt16BE(offset + 10),
            db_items: header.readUInt32BE(offset + 12),
            id_len: header.readUInt8(offset + 16),
            max_region: header.readUInt16BE(offset + 17),
            max_city: header.readUInt16BE(offset + 19),
            region_size: header.readUInt32BE(offset + 21),
            city_size: header.readUInt32BE(offset + 25),
            max_country: header.readUInt16BE(offset + 29),
            country_size: header.readUInt32BE(offset + 31),
            pack_size: header.readUInt16BE(offset + 35)
        };

        if (info['b_idx_len'] * info['m_idx_len'] * info['range'] * info['db_items'] * info['time'] * info['id_len'] == 0) {
            if (this.fh >= 0) fs.closeSync(this.fh);
            throw new Error(`Wrong file format ${dbFile}`);
        }
        if (info.ver < 21 || info.charset > 2 || info.id_len > 4) {
            if (this.fh >= 0) fs.closeSync(this.fh);
            throw new Error(`Unsupported Sypex Geo format ${dbFile}`);
        }

        const minimumSize = 40 + info.pack_size + info.b_idx_len * 4 + info.m_idx_len * 4 +
            info.db_items * (3 + info.id_len) + info.region_size + info.city_size;
        const fileSize = memoryImage?.length ?? fs.fstatSync(this.fh).size;
        if (fileSize < minimumSize) {
            if (this.fh >= 0) fs.closeSync(this.fh);
            throw new Error(`Truncated Sypex Geo database ${dbFile}`);
        }

        this.range = info.range;
        this.b_idx_len = info.b_idx_len;
        this.m_idx_len = info.m_idx_len;
        this.db_items = info.db_items;
        this.id_len = info.id_len;
        this.block_len = 3 + this.id_len;
        this.max_region = info.max_region;
        this.max_city = info.max_city;
        this.max_country = info.max_country;
        this.country_size = info.country_size;
        this.batch_mode = (type & SxGeo.BATCH) !== 0;
        this.memory_mode = (type & SxGeo.MEMORY) !== 0;
        const encodings = ['utf-8', 'iso-8859-1', 'windows-1251'];
        this.decoder = new TextDecoder(encodings[info.charset] ?? 'utf-8');

        if (info.pack_size) {
            const buffer = memoryImage
                ? memoryImage.subarray(40, 40 + info.pack_size)
                : readChunk(this.fh, info.pack_size, 40);
            this.pack = buffer.toString('binary').split('\0');
            for (const format of this.pack) {
                if (format) this.formats.set(format, compileFormat(format));
            }
        }

        const bIdxBufferSize = info['b_idx_len'] * 4;
        const bIdxStart = 40 + info.pack_size;
        const bIdxBuffer = memoryImage
            ? memoryImage.subarray(bIdxStart, bIdxStart + bIdxBufferSize)
            : readChunk(this.fh, bIdxBufferSize, bIdxStart);
        this.b_idx_str = bIdxBuffer;

        const mIdxBufferSize = info['m_idx_len'] * 4;
        const mIdxStart = bIdxStart + bIdxBufferSize;
        const mIdxBuffer = memoryImage
            ? memoryImage.subarray(mIdxStart, mIdxStart + mIdxBufferSize)
            : readChunk(this.fh, mIdxBufferSize, mIdxStart);
        this.m_idx_str = mIdxBuffer;

        this.db_begin = mIdxBufferSize + 40 + info.pack_size + bIdxBufferSize;
        
        if (this.batch_mode) {
            this.b_idx_arr = Array.from(unpackString(this.b_idx_str));
            this.m_idx_arr = unpackString(this.m_idx_str);
        }

        if (this.memory_mode) {
            const image = memoryImage!;
            const dbSize = this.db_items * this.block_len;
            const regionsBegin = this.db_begin + dbSize;
            const citiesBegin = regionsBegin + info.region_size;
            this.db = image.subarray(this.db_begin, regionsBegin);
            this.regions_db = image.subarray(regionsBegin, citiesBegin);
            this.cities_db = image.subarray(citiesBegin, citiesBegin + info.city_size);
        }

        this.info = info;
        this.info.regions_begin = this.db_begin + this.db_items * this.block_len;
        this.info.cities_begin = this.info.regions_begin + info.region_size;
    }

    private searchIdx(ipNumber: number, min: number, max: number): number {
        if (this.batch_mode) {
            while (max - min > 8) {
                const offset = (min + max) >> 1;
                if (ipNumber > this.m_idx_arr[offset]) {
                    min = offset;
                } else {
                    max = offset;
                }
            }

            while (ipNumber > this.m_idx_arr[min]) {
                min++;
                if (min > max) {
                    break;
                }
            }
        } else {
            while (max - min > 8) {
                const offset = (min + max) >> 1;
                if (ipNumber > this.m_idx_str.readUInt32BE(offset * 4)) {
                    min = offset;
                } else {
                    max = offset;
                }
            }

            while (ipNumber > this.m_idx_str.readUInt32BE(min * 4)) {
                min++;
                if (min > max) {
                    break;
                }
            }
        }
        return min;
    }

    private searchDb(str_: Buffer, ipNumber: number, min_: number, max_: number): number {
        const lenBlock = this.block_len;
        const ipTail = ipNumber & 0x00ffffff;
        const firstOffset = min_ * lenBlock;

        if (firstOffset + 3 > str_.length || ipTail < str_.readUIntBE(firstOffset, 3)) return 0;

        if ((max_ - min_) > 1) {
            while ((max_ - min_) > 8) {
                const offset = (min_ + max_) >> 1;
                const start = offset * lenBlock;

                if (ipTail > str_.readUIntBE(start, 3)) {
                    min_ = offset;
                } else {
                    max_ = offset;
                }
            }

            let start = min_ * lenBlock;

            while (ipTail >= str_.readUIntBE(start, 3)) {
                min_ += 1;
                start = min_ * lenBlock;

                if (min_ >= max_) {
                    break;
                }
            }
        } else {
            min_ += 1;
        }

        const lenId = this.id_len;
        const start = min_ * lenBlock - lenId;

        if (start < 0 || start + lenId > str_.length) return 0;
        return str_.readUIntBE(start, lenId);
    }

    private getNum(ip: string): number | false {
        this.assertOpen();
        const ipNumber = parseIpv4(ip);
        if (ipNumber === false) return false;
        const ip1n = ipNumber >>> 24;
        if (ip1n === 0 || ip1n === 10 || ip1n === 127 || ip1n >= this.b_idx_len) {
            return false;
        }

        let blocks: { min: number; max: number };
        if (this.batch_mode) {
            blocks = { min: this.b_idx_arr[ip1n - 1], max: this.b_idx_arr[ip1n] };
        } else {
            const header = this.b_idx_str.subarray((ip1n - 1) * 4, (ip1n - 1) * 4 + 8);
            blocks = {
                min: header.readUInt32BE(0),
                max: header.readUInt32BE(4)
            };
        }

        let min: number, max: number;
        if (blocks.max - blocks.min > this.range) {
            const part = this.searchIdx(ipNumber, Math.floor(blocks.min / this.range), Math.floor(blocks.max / this.range) - 1);

            min = part > 0 ? part * this.range : 0;
            max = part > this.m_idx_len ? this.db_items : (part + 1) * this.range;

            if (min < blocks.min) min = blocks.min;
            if (max > blocks.max) max = blocks.max;
        } else {
            min = blocks.min;
            max = blocks.max;
        }

        const len: number = max - min;

        if (this.memory_mode) {
            return this.searchDb(this.db, ipNumber, min, max);
        }

        const dbChunk = readChunk(this.fh, len * this.block_len, this.db_begin + min * this.block_len);
        return this.searchDb(dbChunk, ipNumber, 0, len);
    }

    private readData(seek: number, max: number, type: number): SxGeo.RecordData {
        let raw: Buffer = Buffer.alloc(0);

        if (seek && max) {
            if (this.memory_mode) {
                let src: Buffer;

                if (type === 1) {
                    src = this.regions_db;
                } else {
                    src = this.cities_db;
                }

                raw = src.subarray(seek, seek + max);
            } else {
                let boundaryKey: keyof Info = 'cities_begin';

                if (type === 1) {
                    boundaryKey = 'regions_begin';
                }

                raw = readChunk(this.fh, max, (this.info[boundaryKey] ?? 0) + seek);
            }
        }

        const unpackedData = this.unpack(this.pack[type], raw);

        return unpackedData;
    }

    private parseCity(seek: number, full: boolean = false): SxGeo.CityResult | SxGeo.CityFullResult {
        if (!this.pack.length) {
            throw new Error('This database does not contain city records');
        }

        let countryOnly = false;
        let city: any, country: any;

        if (seek < this.country_size) {
            country = this.readData(seek, this.max_country, 0);
            city = this.unpack(this.pack[2], Buffer.alloc(0));
            countryOnly = true;
            city.lat = country.lat;
            city.lon = country.lon;
        } else {
            city = this.readData(seek, this.max_city, 2);
            country = { id: city.country_id, iso: this.id2iso[Number(city.country_id)] };
        }

        let region: any = null;

        if (full) {
            region = this.readData(city.region_seek, this.max_region, 1);

            if (!countryOnly) {
                country = this.readData(region.country_seek, this.max_country, 0);
            }

            delete city.country_id;
            delete city.region_seek;
            delete region.country_seek;
            return { city, region, country };
        }

        delete city.country_id;
        delete city.region_seek;
        return { city, country: { id: country.id, iso: country.iso } };
    }
    
    private unpack(pack: string | undefined, item: Buffer): SxGeo.RecordData {
        const unpacked: SxGeo.RecordData = {};
        if (!pack) {
            return unpacked;
        }

        const empty = item.length === 0;
        const fields = this.formats.get(pack) ?? compileFormat(pack);
        let pos = 0;

        for (const field of fields) {
            const { type, name } = field;
            if (empty) {
                unpacked[name] = type === 'b' || type === 'c' ? '' : 0;
                continue;
            }

            let width = field.width;
            let value: number | string;
            switch (type) {
                case 't':
                    value = item.readInt8(pos);
                    break;
                case 'T':
                    value = item.readUInt8(pos);
                    break;
                case 's':
                    value = item.readInt16LE(pos);
                    break;
                case 'S':
                    value = item.readUInt16LE(pos);
                    break;
                case 'm':
                    value = item.readIntLE(pos, 3);
                    break;
                case 'M':
                    value = item.readUIntLE(pos, 3);
                    break;
                case 'i':
                    value = item.readInt32LE(pos);
                    break;
                case 'I':
                    value = item.readUInt32LE(pos);
                    break;
                case 'f':
                    value = item.readFloatLE(pos);
                    break;
                case 'd':
                    value = item.readDoubleLE(pos);
                    break;
                case 'n':
                    value = item.readInt16LE(pos) / field.scale;
                    break;
                case 'N':
                    value = item.readInt32LE(pos) / field.scale;
                    break;
                case 'c': {
                    value = this.decoder.decode(item.subarray(pos, pos + width)).replace(/ +$/, '');
                    break;
                }
                case 'b': {
                    const end = item.indexOf(0, pos);
                    const stringEnd = end === -1 ? item.length : end;
                    value = this.decoder.decode(item.subarray(pos, stringEnd));
                    width = stringEnd - pos + (end === -1 ? 0 : 1);
                    break;
                }
                default: {
                    value = Number.parseInt(item.toString('utf8', pos, pos + width), 10);
                    break;
                }
            }

            pos += width;
            unpacked[name] = value;
        }

        return unpacked;
    }

    get(ip: string): SxGeo.CityResult | string | false {
        return this.max_city ? this.getCity(ip) : this.getCountry(ip);
    }

    getCountry(ip: string): string | false {
        const num = this.getNum(ip);
        if (num === false) return false;
        if (this.max_city) {
            return this.getCountryIdentity(num).iso;
        }
        return this.id2iso[num];
    }

    getCountryId(ip: string): number | false {
        const num = this.getNum(ip);
        if (num === false) return false;
        if (this.max_city) {
            return this.getCountryIdentity(num).id;
        }
        return num;
    }

    getCity(ip: string): SxGeo.CityResult | false {
        if (!this.max_city || !this.pack.length) return false;
        const seek = this.getNum(ip);
        if (!seek) return false;
        const entry = this.cityCache.get(seek);
        if (entry?.short) return this.cloneCityResult(entry.short);

        const result = this.parseCity(seek, false) as SxGeo.CityResult;
        this.cacheCityResult(seek, { ...entry, short: result });
        return this.cloneCityResult(result);
    }

    getCityFull(ip: string): SxGeo.CityFullResult | false {
        if (!this.max_city || !this.pack.length) return false;
        const seek = this.getNum(ip);
        if (!seek) return false;
        const entry = this.cityCache.get(seek);
        if (entry?.full) return this.cloneCityFullResult(entry.full);

        const result = this.parseCity(seek, true) as SxGeo.CityFullResult;
        this.cacheCityResult(seek, { ...entry, full: result });
        return this.cloneCityFullResult(result);
    }

    /** Resolve several addresses while preserving input order. */
    getMany(ips: readonly string[]): Array<SxGeo.CityResult | string | false> {
        return ips.map((ip) => this.get(ip));
    }

    getCountryMany(ips: readonly string[]): Array<string | false> {
        return ips.map((ip) => this.getCountry(ip));
    }

    getCityMany(ips: readonly string[], full = false): Array<SxGeo.CityResult | SxGeo.CityFullResult | false> {
        return full ? ips.map((ip) => this.getCityFull(ip)) : ips.map((ip) => this.getCity(ip));
    }

    getDbVersion(): number {
        return this.info.ver;
    }

    getDbDate(): Date {
        return new Date(this.info.time * 1000);
    }

    /** Close the database file. Calling close more than once is safe. */
    close(): void {
        if (!this.closed) {
            if (this.fh >= 0) fs.closeSync(this.fh);
            this.closed = true;
        }
    }

    /** Clear bounded lookup caches without closing the database. */
    clearCache(): void {
        this.countryCache.clear();
        this.cityCache.clear();
    }

    /** Explicit resource management support (`using geo = new SxGeo(...)`). */
    [Symbol.dispose](): void {
        this.close();
    }

    private assertOpen(): void {
        if (this.closed) {
            throw new Error('SxGeo database is closed');
        }
    }

    private getCountryIdentity(seek: number): { id: number; iso: string } {
        const cached = this.countryCache.get(seek);
        if (cached) return cached;

        const result = this.parseCity(seek, false) as SxGeo.CityResult;
        const identity = {
            id: Number(result.country.id),
            iso: String(result.country.iso)
        };

        if (this.countryCache.size >= 4096) {
            const oldest = this.countryCache.keys().next().value;
            if (oldest !== undefined) this.countryCache.delete(oldest);
        }
        this.countryCache.set(seek, identity);
        return identity;
    }

    private cacheCityResult(
        seek: number,
        value: { short?: SxGeo.CityResult; full?: SxGeo.CityFullResult }
    ): void {
        if (!this.cityCache.has(seek) && this.cityCache.size >= 4096) {
            const oldest = this.cityCache.keys().next().value;
            if (oldest !== undefined) this.cityCache.delete(oldest);
        }
        this.cityCache.set(seek, value);
    }

    private cloneCityResult(result: SxGeo.CityResult): SxGeo.CityResult {
        return { city: { ...result.city }, country: { ...result.country } };
    }

    private cloneCityFullResult(result: SxGeo.CityFullResult): SxGeo.CityFullResult {
        return {
            city: { ...result.city },
            region: { ...result.region },
            country: { ...result.country }
        };
    }

    /**
     * Returns metadata about the currently opened Sypex Geo database.
     */
    about(): AboutInfo {
        const charset = ['utf-8', 'latin1', 'cp1251'];
        const types = ['n/a', 'SxGeo Country', 'SxGeo City RU', 'SxGeo City EN', 'SxGeo City', 'SxGeo City Max RU', 'SxGeo City Max EN', 'SxGeo City Max'];

        return {
            version: this.info.ver,
            created: new Date(this.info.time * 1000).toISOString().split('T')[0].replace(/-/g, '.'),
            timestamp: this.info.time,
            charset: charset[this.info.charset],
            type: types[this.info.type],
            byteIndex: this.b_idx_len,
            mainIndex: this.m_idx_len,
            blocksInIndexItem: this.range,
            ipBlocks: this.db_items,
            blockSize: this.block_len,
            city: {
                maxLength: this.max_city,
                totalSize: this.info.city_size
            },
            region: {
                maxLength: this.max_region,
                totalSize: this.info.region_size
            },
            country: {
                maxLength: this.max_country,
                totalSize: this.info.country_size
            }
        };
    }
}

namespace SxGeo {
    export type FieldValue = number | string;
    export type RecordData = Record<string, FieldValue>;

    export interface CityResult {
        city: RecordData;
        country: RecordData;
    }

    export interface CityFullResult extends CityResult {
        region: RecordData;
    }
}

export = SxGeo;
