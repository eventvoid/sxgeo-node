import * as fs from 'node:fs';

function ip2long(ip: string): number | false {
    const ipArray = ip.split('.');

    if (ipArray.length !== 4) {
        return false;
    }

    for (const octet of ipArray) {
        const numericOctet = parseInt(octet, 10);
        if (isNaN(numericOctet) || numericOctet < 0 || numericOctet > 255) {
            return false;
        }
    }

    const long = (parseInt(ipArray[0], 10) << 24) |
        (parseInt(ipArray[1], 10) << 16) |
        (parseInt(ipArray[2], 10) << 8) |
        parseInt(ipArray[3], 10);
    
    if (long > 0x7FFFFFFF) {
        return long - 0xFFFFFFFF - 1;
    }

    return long;
}

function unpackString(buffer: Buffer): number[] {
    const result: number[] = [];

    for (let i = 0; i < buffer.length; i += 4) {
        const value = buffer.readUInt32BE(i);
        result.push(value);
    }

    return result;
}

function strSplit(inputString: Buffer, length: number): Buffer[] {
    const result: Buffer[] = [];
    const uint8Array = new Uint8Array(inputString);

    for (let i = 0; i < uint8Array.length; i += length) {
        result.push(Buffer.from(uint8Array.slice(i, i + length)));
    }

    return result;
}

function readChunk(fd: number, length: number, position: number): Buffer {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, position);

    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

const SXGEO_FILE = 0;
const SXGEO_MEMORY = 1;
const SXGEO_BATCH = 2;

interface AboutInfo {
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

class SxGeo {
    static readonly FILE = SXGEO_FILE;
    static readonly MEMORY = SXGEO_MEMORY;
    static readonly BATCH = SXGEO_BATCH;
    static readonly MODES = {
        FILE: SXGEO_FILE,
        MEMORY: SXGEO_MEMORY,
        BATCH: SXGEO_BATCH
    } as const;

    fh: number;
    range: number;
    b_idx_len: number;
    m_idx_len: number;
    db_items: number;
    id_len: number;
    block_len: number;
    max_region: number;
    max_city: number;
    max_country: number;
    country_size: number;
    batch_mode: boolean = false;
    memory_mode: boolean = false;
    pack: string[] = [];
    b_idx_str: Buffer = Buffer.alloc(0);
    m_idx_str: Buffer = Buffer.alloc(0);
    info!: Info;
    db_begin: number;
    b_idx_arr: number[] = [];
    m_idx_arr: Buffer[] = [];
    db: Buffer = Buffer.alloc(0);
    regions_db: Buffer = Buffer.alloc(0);
    cities_db: Buffer = Buffer.alloc(0);
    ip1c: string = '';

    ip2iso: string[] = ['', 'AP', 'EU', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'CW', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU',
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
    constructor(dbFile = 'SxGeo.dat', type = SXGEO_FILE) {
        if (!fs.existsSync(dbFile)) {
            throw new Error("Can't open file");
        }

        this.fh = fs.openSync(dbFile, 'r');

        const header = Buffer.alloc(40);
        fs.readSync(this.fh, header, 0, 40, 0);
        if (header.toString('utf8', 0, 3) !== 'SxG') {
            fs.closeSync(this.fh);
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
            throw new Error(`Wrong file format ${dbFile}`);
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

        if (info.pack_size) {
            const buffer = readChunk(this.fh, info.pack_size, 40);
            this.pack = buffer.toString('binary').split('\0');
        }

        const bIdxBufferSize = info['b_idx_len'] * 4;
        const bIdxBuffer = Buffer.alloc(bIdxBufferSize);

        fs.readSync(this.fh, bIdxBuffer, 0, bIdxBufferSize, 40 + info.pack_size);
        this.b_idx_str = bIdxBuffer;

        const mIdxBufferSize = info['m_idx_len'] * 4;
        const mIdxBuffer = Buffer.alloc(mIdxBufferSize);

        fs.readSync(this.fh, mIdxBuffer, 0, mIdxBufferSize, 40 + info.pack_size + bIdxBufferSize);
        this.m_idx_str = mIdxBuffer;

        this.db_begin = mIdxBufferSize + 40 + info.pack_size + bIdxBufferSize;
        
        if (this.batch_mode) {
            this.b_idx_arr = Array.from(unpackString(this.b_idx_str));
            this.m_idx_arr = strSplit(this.m_idx_str, 4);
        }

        if (this.memory_mode) {
            const bIdxBufferSize = this.db_items * this.block_len;
            const bIdxBuffer = Buffer.alloc(bIdxBufferSize);
            
            fs.readSync(this.fh, bIdxBuffer, 0, bIdxBufferSize, this.db_begin);
            this.db = bIdxBuffer;

            if (info.region_size > 0) {
                const regionBuffer = Buffer.alloc(info.region_size);
                fs.readSync(this.fh, regionBuffer, 0, info.region_size, this.db_begin + bIdxBufferSize);
                this.regions_db = regionBuffer;
            } else {
                this.regions_db = Buffer.alloc(0);
            }

            if (info.city_size > 0) {
                const citiesdbBufferSize = info.city_size;
                const citiesdbBuffer = Buffer.alloc(citiesdbBufferSize);

                fs.readSync(this.fh, citiesdbBuffer, 0, citiesdbBufferSize, this.db_begin + bIdxBufferSize + info.region_size);
                this.cities_db = citiesdbBuffer;
            } else {
                this.cities_db = Buffer.alloc(0);
            }
        }

        this.info = info;
        this.info.regions_begin = this.db_begin + this.db_items * this.block_len;
        this.info.cities_begin = this.info.regions_begin + info.region_size;
    }

    protected searchIdx(ipn: Buffer, min: number, max: number): number {
        if (this.batch_mode) {
            while (max - min > 8) {
                const offset = (min + max) >> 1;
                if (Buffer.compare(ipn, this.m_idx_arr[offset]) > 0) {
                    min = offset;
                } else {
                    max = offset;
                }
            }

            while (Buffer.compare(ipn, this.m_idx_arr[min]) > 0) {
                min++;
                if (min > max) {
                    break;
                }
            }
        } else {
            while (max - min > 8) {
                const offset = (min + max) >> 1;
                if (Buffer.compare(ipn, this.m_idx_str.subarray(offset * 4, offset * 4 + 4)) > 0) {
                    min = offset;
                } else {
                    max = offset;
                }
            }

            while (Buffer.compare(ipn, this.m_idx_str.subarray(min * 4, min * 4 + 4)) > 0) {
                min++;
                if (min > max) {
                    break;
                }
            }
        }
        return min;
    }

    searchDb(str_: Buffer, ipn: Buffer, min_: number, max_: number): number {
        const lenBlock = this.block_len;

        if ((max_ - min_) > 1) {
            ipn = Buffer.from(new Uint8Array(ipn).slice(1));

            while ((max_ - min_) > 8) {
                const offset = (min_ + max_) >> 1;
                const start = offset * lenBlock;

                if (Buffer.compare(ipn, Buffer.from(new Uint8Array(str_).slice(start, start + 3))) > 0) {
                    min_ = offset;
                } else {
                    max_ = offset;
                }
            }

            let start = min_ * lenBlock;

            while (Buffer.compare(ipn, Buffer.from(new Uint8Array(str_).slice(start, start + 3))) >= 0) {
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

        return parseInt(Buffer.from(new Uint8Array(str_).slice(start, start + lenId)).toString('hex'), 16);
    }

    public getNum(ip: string): any {
        const ip1n: number = parseInt(ip, 10);
        let ipn: any = ip2long(ip);
        if (ip1n === 0 || ip1n === 10 || ip1n === 127 || ip1n >= this.b_idx_len || isNaN(ip1n) || ipn === false) {
            return false;
        }

        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setUint32(0, ipn, false);
        const byteArray = new Uint8Array(buffer);
        ipn = Buffer.from(byteArray);

        this.ip1c = String.fromCharCode(ip1n);

        let blocks: { min: number; max: number };
        if (this.batch_mode) {
            blocks = { min: this.b_idx_arr[ip1n - 1], max: this.b_idx_arr[ip1n] };
        } else {
            const header = Buffer.from(new Uint8Array(this.b_idx_str).slice((ip1n - 1) * 4, (ip1n - 1) * 4 + 8));
            blocks = {
                min: header.readUInt32BE(0),
                max: header.readUInt32BE(4)
            };
        }

        let min: number, max: number;
        if (blocks.max - blocks.min > this.range) {
            const part: number = this.searchIdx(ipn, Math.floor(blocks.min / this.range), Math.floor(blocks.max / this.range) - 1);

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
            return this.searchDb(this.db, ipn, min, max);
        }

        const dbChunk = readChunk(this.fh, len * this.block_len, this.db_begin + min * this.block_len);
        return this.searchDb(dbChunk, ipn, 0, len);
    }

    readData(seek: number, max: number, type: number) {
        let raw: Buffer = Buffer.alloc(0);

        if (seek && max) {
            if (this.memory_mode) {
                let src: Buffer;

                if (type === 1) {
                    src = this.regions_db;
                } else {
                    src = this.cities_db;
                }

                raw = Buffer.from(new Uint8Array(src).slice(seek, seek + max));
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

    parseCity(seek: number, full: boolean = false) {
        if (!this.pack.length) {
            return {};
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
            country = {
                id: city.country_id,
                iso: this.ip2iso[city.country_id]
            };
            delete city.country_id;
        }

        let region: any = null;

        if (full) {
            region = this.readData(city.region_seek, this.max_region, 1);

            if (!countryOnly) {
                country = this.readData(region.country_seek, this.max_country, 0);
            }

            delete city.region_seek;
            delete region.country_seek;

            return { city, region, country };
        }

        delete city.region_seek;
        return { city, country: { id: country.id, iso: country.iso } };
    }
    
    unpack(pack: string | undefined, item: Buffer): { [key: string]: any } {
        const unpacked: { [key: string]: any } = {};
        if (!pack) {
            return unpacked;
        }

        const empty = item.length === 0;
        const packArray = pack.split('/');
        let pos = 0;

        packArray.forEach((p) => {
            const [type, name] = p.split(':');
            const type0 = type.charAt(0);

            if (empty) {
                unpacked[name] = type0 === 'b' || type0 === 'c' ? '' : 0;
                return;
            }

            let l: number;
            switch (type0) {
                case 't':
                case 'T':
                    l = 1;
                    break;
                case 's':
                case 'n':
                case 'S':
                    l = 2;
                    break;
                case 'm':
                case 'M':
                    l = 3;
                    break;
                case 'd':
                    l = 8;
                    break;
                case 'c':
                    l = parseInt(type.slice(1).toString(), 10);
                    break;
                case 'b':
                    {
                        const end = item.indexOf(0, pos);
                        l = end === -1 ? item.length - pos : end - pos;
                    }
                    break;
                default:
                    l = 4;
            }

            const val: Buffer = Buffer.from(new Uint8Array(item).slice(pos, pos + l));

            let v: any;
            switch (type0) {
                case 't':
                    v = val.readInt8(0);
                    break;
                case 'T':
                    v = val.readUInt8(0);
                    break;
                case 's':
                    v = val.readInt16LE(0);
                    break;
                case 'S':
                    v = val.readUInt16LE(0);
                    break;
                case 'm':
                    v = val.readIntLE(0, 3);
                    break;
                case 'M':
                    v = val.readUIntLE(0, 3);
                    break;
                case 'i':
                    v = val.readInt32LE(0);
                    break;
                case 'I':
                    v = val.readUInt32LE(0);
                    break;
                case 'f':
                    v = val.readFloatLE(0);
                    break;
                case 'd':
                    v = val.readDoubleLE(0);
                    break;
                case 'n':
                    v = val.readInt16LE(0) / Math.pow(10, parseInt(type.charAt(1), 10));
                    break;
                case 'N':
                    v = val.readInt32LE(0) / Math.pow(10, parseInt(type.charAt(1), 10));
                    break;
                case 'c':
                    v = val.toString('utf8').replace(/ +$/, '');
                    break;
                case 'b':
                    v = val.toString('utf8');
                    l++;
                    break;
                default:
                    v = parseInt(val.toString('utf8'), 10);
                    break;
            }
            
            pos += l;
            unpacked[name] = v;
        });

        return unpacked;
    }

    get(ip: string) {
        return this.max_city ? this.getCity(ip) : this.getCountry(ip);
    }

    getCountry(ip: string) {
        const num = this.getNum(ip);
        if (this.max_city) {
            const tmp = this.parseCity(num);
            return tmp.country.iso;
        }
        return this.ip2iso[num];
    }

    getCountryId(ip: string) {
        const num = this.getNum(ip);
        if (this.max_city) {
            const tmp = this.parseCity(num);
            return tmp.country.id;
        }
        return num;
    }

    getCity(ip: string) {
        const seek = this.getNum(ip);
        return seek ? this.parseCity(seek, false) : false;
    }

    getCityFull(ip: string) {
        const seek = this.getNum(ip);
        return seek ? this.parseCity(seek, true) : false;
    }

    /**
     * Returns metadata about the currently opened Sypex Geo database.
     */
    about(): AboutInfo {
        const charset = ['utf-8', 'latin1', 'cp1251'];
        const types = ['n/a', 'SxGeo Country', 'SxGeo City RU', 'SxGeo City EN', 'SxGeo City', 'SxGeo City Max RU', 'SxGeo City Max EN', 'SxGeo City Max'];

        return {
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

export = SxGeo;
