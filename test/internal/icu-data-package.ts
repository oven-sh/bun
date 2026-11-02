/** An item is its bytes, or that many bytes of filler. */
export function packageOf(items: [name: string, body: number | Buffer][], headerSize = 32): Buffer {
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(headerSize, 0);
  header.writeUInt16BE(0xda27, 2);
  header.write("CmnD\x01", 12, "latin1");
  const names = items.map(([name]) => Buffer.from(name + "\0", "latin1"));
  const entries = Buffer.alloc(4 + items.length * 8);
  entries.writeUInt32LE(items.length, 0);
  let at = entries.length;
  names.forEach((name, index) => {
    entries.writeUInt32LE(at, 4 + index * 8);
    at += name.length;
  });
  const bodies = items.map(([, body], index) => {
    const padding = (16 - (at % 16)) % 16;
    entries.writeUInt32LE(at + padding, 8 + index * 8);
    const bytes = typeof body === "number" ? Buffer.alloc(body, 0xaa) : body;
    at += padding + bytes.length;
    return Buffer.concat([Buffer.alloc(padding, 0xaa), bytes]);
  });
  return Buffer.concat([header, entries, ...names, ...bodies]);
}

class BundleAlias {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
}

/** A resource that is an alias of the resource at `path`. */
export const aliasTo = (path: string) => new BundleAlias(path);

/** A string, an integer, a table, an array, or an alias. */
export type BundleValue = string | number | BundleTable | BundleValue[] | BundleAlias;
export type BundleTable = { [key: string]: BundleValue };

const padded = (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(-bytes.length & 3, 0xaa)]);
const words16 = (values: number[]) => Buffer.from(new Uint16Array(values).buffer);
const words32 = (values: number[]) => Buffer.from(new Uint32Array(values).buffer);

function headerOf(formatVersion: number): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt16LE(32, 0);
  header.writeUInt16BE(0xda27, 2);
  header.writeUInt16LE(20, 4);
  header[10] = 2;
  header.write("ResB", 12, "latin1");
  header[16] = formatVersion;
  header.writeUInt16BE(0x0104, 20);
  return header;
}

const isTable = (value: BundleValue): value is BundleTable =>
  typeof value === "object" && !Array.isArray(value) && !(value instanceof BundleAlias);
const sorted = (table: BundleTable) => Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1));
/** The values of a table in the order of its keys, or the elements of an array. */
const childrenOf = (value: BundleValue): BundleValue[] =>
  Array.isArray(value) ? value : isTable(value) ? sorted(value).map(([, child]) => child) : [];

/**
 * A resource bundle as ICU's genrb writes one of format version 2 that uses no pool bundle: the key strings in the order of
 * the source, then the 16-bit units (a zero, the strings, the tables and the arrays of strings), then the other resources,
 * each after what it contains. `realBundles` has what genrb wrote for four of these tables. genrb also writes a key that
 * ends another key only once. An alias is laid out as uresdata.h has it: no bundle of a locale has one to compare with.
 */
export function bundleOf(root: BundleTable, { noFallback = false } = {}): Buffer {
  const firstKey = 4 * (1 + 7);
  const keyOffsets = new Map<string, number>();
  let keysLength = 0;
  const collectKeys = (value: BundleValue) => {
    if (Array.isArray(value)) return value.forEach(collectKeys);
    if (!isTable(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (!keyOffsets.has(key)) {
        keyOffsets.set(key, firstKey + keysLength);
        keysLength += key.length + 1;
      }
      collectKeys(child);
    }
  };
  collectKeys(root);
  const keyBytes = padded(Buffer.from([...keyOffsets.keys()].map(key => key + "\0").join(""), "latin1"));
  const keyOffset = (key: string) => keyOffsets.get(key)!;

  const units: number[] = [0];
  const stringOffset = new Map<string, number>([["", 0]]);
  const collectStrings = (value: BundleValue) => {
    for (const child of childrenOf(value)) collectStrings(child);
    if (typeof value !== "string" || stringOffset.has(value)) return;
    stringOffset.set(value, units.length);
    units.push(...Buffer.from(value, "latin1"), 0);
  };
  collectStrings(root);
  const in16BitUnits = new Map<BundleValue, number>();
  const collect16BitUnits = (value: BundleValue) => {
    const children = childrenOf(value);
    for (const child of children) collect16BitUnits(child);
    if (children.length === 0 || children.some(child => typeof child !== "string")) return;
    in16BitUnits.set(value, units.length);
    units.push(children.length, ...(isTable(value) ? sorted(value).map(([key]) => keyOffset(key)) : []));
    units.push(...children.map(child => stringOffset.get(child as string)!));
  };
  collect16BitUnits(root);
  const unitBytes = padded(words16(units));
  const firstResource = firstKey + keyBytes.length + unitBytes.length;
  const resources: Buffer[] = [];
  let resourcesLength = 0;
  let maxTableLength = 0;
  const write = (type: number, ...bytes: Buffer[]) => {
    const offset = (firstResource + resourcesLength) / 4;
    resources.push(...bytes);
    resourcesLength += bytes.reduce((length, part) => length + part.length, 0);
    return ((type << 28) | offset) >>> 0;
  };
  const resourceOf = (value: BundleValue): number => {
    if (typeof value === "string") return ((6 << 28) | stringOffset.get(value)!) >>> 0;
    if (typeof value === "number") return ((7 << 28) | value) >>> 0;
    if (value instanceof BundleAlias) {
      const characters = Buffer.from(value.path + "\0", "utf16le");
      return write(3, words32([value.path.length]), padded(characters));
    }
    const children = childrenOf(value);
    if (isTable(value)) maxTableLength = Math.max(maxTableLength, children.length);
    if (children.length === 0) return ((isTable(value) ? 2 : 8) << 28) >>> 0;
    if (in16BitUnits.has(value)) return (((isTable(value) ? 5 : 9) << 28) | in16BitUnits.get(value)!) >>> 0;
    const values = words32(children.map(child => resourceOf(child)));
    if (!isTable(value)) return write(8, words32([children.length]), values);
    return write(2, padded(words16([children.length, ...sorted(value).map(([key]) => keyOffset(key))])), values);
  };
  const rootResource = resourceOf(root);
  const keysTop = (firstKey + keyBytes.length) / 4;
  const unitsTop = firstResource / 4;
  const bundleTop = (firstResource + resourcesLength) / 4;
  const indexes = [7, keysTop, bundleTop, bundleTop, maxTableLength, noFallback ? 1 : 0, unitsTop];
  return Buffer.concat([headerOf(2), words32([rootResource, ...indexes]), keyBytes, unitBytes, ...resources]);
}

/** A pool bundle with these key strings and strings at these offsets of its key strings and of its 16-bit units. */
export function poolBundleOf(checksum: number, keys: Record<number, string>, strings: Record<number, string>): Buffer {
  const firstKey = 4 * (1 + 8);
  const keyEntries = Object.entries(keys).map(([offset, key]) => [Number(offset), key] as const);
  const stringEntries = Object.entries(strings).map(([offset, string]) => [Number(offset), string] as const);
  const keyBytes = Buffer.alloc((Math.max(0, ...keyEntries.map(([offset, key]) => offset + key.length + 1)) + 3) & ~3);
  for (const [offset, key] of keyEntries) keyBytes.write(key, offset, "latin1");
  const unitCount = Math.max(1, ...stringEntries.map(([offset, string]) => offset + string.length + 1));
  const unitBytes = Buffer.alloc((2 * unitCount + 3) & ~3);
  for (const [offset, string] of stringEntries) unitBytes.write(string, 2 * offset, "utf16le");
  const keysTop = (firstKey + keyBytes.length) / 4;
  const bundleTop = keysTop + unitBytes.length / 4;
  const isPoolBundleWithoutFallback = 3;
  const indexes = [8, keysTop, bundleTop, bundleTop, 0, isPoolBundleWithoutFallback, bundleTop, checksum];
  return Buffer.concat([headerOf(3), words32([2 << 28, ...indexes]), keyBytes, unitBytes]);
}

const real = (hex: string) => Buffer.from(hex.replace(/\s/g, ""), "hex");

/**
 * Items of the data package of ICU 79.1, as genrb wrote them. With `realPools` they are the bundles that ICU loads:
 * a pool bundle here has only the keys and the strings that these bundles refer to, at the offsets of the real one.
 */
export const realBundles = {
  // {} with format version 2 and no pool bundle.
  "coll/dz.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    0000002007000000080000000900000009000000000000000000000009000000
    0000aaaa`),
  // { ___ { "" } }
  "coll/ar_SA.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    0100005007000000090000000b0000000b00000001000000000000000b000000
    5f5f5f000000010020000000`),
  // { "%%ALIAS" { "id" } }: a table of strings with its key and its string in the bundle.
  "coll/in.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    04000050070000000a0000000e0000000e00000001000000000000000e000000
    2525414c494153000000690064000000010020000100aaaa`),
  // { "%%Parent" { "no" } }
  "coll/nb.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    04000050070000000b0000000f0000000f00000001000000000000000f000000
    2525506172656e7400aaaaaa00006e006f000000010020000100aaaa`),
  // { InstalledLocales { de {""} ... zh_Hant {""} } AliasLocales {} }: a table of tables. The key `es` is the end of `AliasLocales`.
  "brkitr/res_index.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    2d000020070000001e00000031000000310000000e000000010000002d000000
    496e7374616c6c65644c6f63616c657300646500656c00656e00656e5f555300
    656e5f55535f504f534958006672006974006a61006b6f007074007275007a68
    007a685f48616e7400416c6961734c6f63616c657300aaaa00000e0031003400
    37003a00400073004c004f005200550058005b005e0061000000000000000000
    0000000000000000000000000000000000000000020069002000aaaa00000020
    01000050`),
  // { "%%ALIAS" { "ar_SA" } } with format version 2: the key is in the pool bundle, at 4862.
  "ars.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    0700005008000000090000000e0000000e00000001000000040000000e000000
    f15bd6d30000610072005f005300410000000100fe120100`),
  // { "%%ALIAS" { "he" } } with format version 3: the key is in the pool bundle at 1148, the string at 4540.
  "curr/iw.res": real(`
    2000da2714000000000002005265734203000000010400000000000000000000
    0100005008bd1100090000000b0000000b000000010000000400bd110b000000
    800d624e000001007c04bc11`),
  // { "%%Parent" { "en_150" } }: the key is in the pool bundle at 1341, the string at 1579.
  "curr/en_BE.res": real(`
    2000da2714000000000002005265734203000000010400000000000000000000
    01000050082c0600090000000b0000000b0000000100000004002c060b000000
    800d624e000001003d052b06`),
  // { "%%ALIAS" { "ro" } } as a table of resources: the string is in the pool bundle at 68300, too far for a table of strings.
  "unit/mo.res": real(`
    2000da2714000000000002005265734203000000010400000000000000000000
    0a00002008cd0a01090000000c0000000c000000010000000400ffff0a000000
    a156a39d0000aaaa01005509cc0a0160`),
  // { "%%Parent" { "pt_PT" } NumberElements { ... } }: keys at 5139 and 76, the string at 2491.
  "pt_AO.res": real(`
    2000da2714000000000002005265734203000000010400000000000000000000
    0b00002008bc0900090000000f0000000f000000020000000400bc090b000000
    f15bd6d30000010008162d07020013144c00aaaabb09006001000050`),
  // { boundaries { sentence:process(dependency) { "sent_el.brk" } } }: genrb adds "%%DEPENDENCY" { "sent_el.brk" }, an array of strings.
  "brkitr/el.res": real(`
    2000da2714000000000002005265734202000000010400000000000000000000
    1a00002007000000110000001e0000001e00000002000000000000001a000000
    626f756e646172696573002525444550454e44454e43590073656e74656e6365
    00aaaaaa0000730065006e0074005f0065006c002e00620072006b0000000100
    010001003800010002002b002000aaaa0d0000900f000050`),
};

export const realPools = {
  "pool.res": poolBundleOf(0xd3d65bf1, { 76: "NumberElements", 4862: "%%ALIAS", 5139: "%%Parent" }, { 2491: "pt_PT" }),
  "curr/pool.res": poolBundleOf(0x4e620d80, { 1148: "%%ALIAS", 1341: "%%Parent" }, { 1579: "en_150", 4540: "he" }),
  "unit/pool.res": poolBundleOf(0x9da356a1, { 2389: "%%ALIAS" }, { 68300: "ro" }),
};
