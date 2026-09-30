// Writes fixtures.tar.gz.
//
//   bun generate.ts inputs <a checkout of oven-sh/icu>   what the questions are asked about
//   <bun> generate.ts expected [section...]              the answers of that build of Bun
//
// The answers are the ground truth, so <bun> has to be a build whose ICU has ICU's own data.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packWords, readExpected, writeFixtures } from "./fixtures";
import { ask } from "./pool";
import { sections } from "./questions";

const [mode, ...rest] = process.argv.slice(2);
if (mode === "expected") {
  const names = rest.length ? rest : Object.keys(sections);
  const expected = rest.length ? await readExpected() : new Map<string, string>();
  for (const key of expected.keys()) if (names.includes(key.slice(0, key.indexOf("/")))) expected.delete(key);
  for (const [, answers] of ask(names)) for (const [key, hash] of await answers) expected.set(key, hash);
  await writeFixtures({
    "expected.txt": [...expected]
      .sort()
      .map(([key, hash]) => `${key}\t${hash}`)
      .join("\n"),
  });
  console.log(`${expected.size} subjects`);
  process.exit();
}
if (mode !== "inputs" || !rest[0]) throw new Error("usage: generate.ts inputs <icu> | expected [section...]");

const source = join(rest[0], "icu4c/source");
const data = join(source, "data");
const inputs: Record<string, unknown> = {};
const files: Record<string, string> = {};
const save = (name: string, value: unknown) => (inputs[name] = value);
const stems = (dir: string) =>
  readdirSync(join(data, dir))
    .filter(f => f.endsWith(".txt"))
    .map(f => f.slice(0, -4))
    .sort();

// ─── ICU resource bundle text ───

type Res = string | Res[] | { [key: string]: Res };

/** Enough of genrb's grammar to read the shipped bundles: tables, arrays, strings; other types come out as strings. */
function parseBundle(text: string): { [key: string]: Res } {
  let i = 0;
  const skip = () => {
    for (;;) {
      while (i < text.length && /[\s\ufeff]/.test(text[i]!)) i++;
      if (text.startsWith("//", i)) i = text.indexOf("\n", i) >>> 0;
      else if (text.startsWith("/*", i)) i = text.indexOf("*/", i) + 2;
      else return;
    }
  };
  const quoted = (): string => {
    let out = "";
    i++;
    while (text[i] !== '"') {
      if (text[i] === "\\") {
        const c = text[i + 1]!;
        if (c === "u") ((out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16))), (i += 6));
        else if (c === "U") ((out += String.fromCodePoint(parseInt(text.slice(i + 2, i + 10), 16))), (i += 10));
        else ((out += c), (i += 2));
      } else out += text[i++];
    }
    i++;
    return out;
  };
  const bare = (): string => {
    const start = i;
    while (i < text.length && !/[\s{},:"]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };
  const token = () => (text[i] === '"' ? quoted() : bare());

  /** After the `{`. */
  const body = (): Res => {
    skip();
    if (text[i] === "}") return (i++, "");
    const strings: Res[] = [];
    const table: { [key: string]: Res } = {};
    let isTable = false;
    let sawComma = false;
    for (;;) {
      skip();
      if (text[i] === "}") {
        i++;
        break;
      }
      if (text[i] === ",") {
        i++;
        sawComma = true;
        continue;
      }
      if (text[i] === "{") {
        i++;
        strings.push(body());
        sawComma = true;
        continue;
      }
      const wasQuoted = text[i] === '"';
      let value = token();
      skip();
      if (text[i] === ":") {
        i++;
        bare();
        if (text[i] === "(") i = text.indexOf(")", i) + 1;
        skip();
      }
      if (text[i] === "{") {
        i++;
        table[value] = body();
        isTable = true;
        continue;
      }
      // Adjacent quoted strings are one string.
      while (wasQuoted && text[i] === '"') {
        value += quoted();
        skip();
      }
      strings.push(value);
    }
    if (isTable) return table;
    return strings.length === 1 && !sawComma ? strings[0]! : strings;
  };

  skip();
  bare();
  skip();
  if (text[i] === ":") {
    i++;
    bare();
    if (text[i] === "(") i = text.indexOf(")", i) + 1;
    skip();
  }
  i++;
  return body() as { [key: string]: Res };
}

const bundle = (path: string) => parseBundle(readFileSync(join(data, path), "utf8"));
const keys = (res: Res | undefined) => (res && typeof res === "object" && !Array.isArray(res) ? Object.keys(res) : []);

// ─── Locales ───

const toBcp47 = (id: string): string | undefined => {
  if (id === "root") return "und";
  if (id === "en_US_POSIX") return "en-US-u-va-posix";
  if (/__|_$|_TRADITIONAL$/.test(id)) return undefined;
  const tag = id.replaceAll("_", "-");
  // ICU's own legacy identifiers (no_NO_NY) are not language tags.
  try {
    Intl.getCanonicalLocales(tag);
  } catch {
    return undefined;
  }
  return tag;
};
const locales = (dir: string) => [...new Set(stems(dir).flatMap(id => toBcp47(id) ?? []))];
save(
  "trees",
  Object.fromEntries(
    ["locales", "curr", "lang", "region", "unit", "zone", "coll", "brkitr", "rbnf"].map(dir => [
      dir,
      locales(dir).filter(l => !/^(supplementalData|tzdbNames)$/.test(l)),
    ]),
  ),
);

// ─── Display name codes ───

const union = (dir: string, table: string) => {
  const found = new Set<string>();
  for (const stem of stems(dir)) {
    if (stem === "supplementalData" || stem === "tzdbNames") continue;
    for (const k of keys(bundle(`${dir}/${stem}.txt`)[table])) found.add(k);
  }
  return [...found].sort();
};
const langEn = bundle("lang/en.txt");
save("codes", {
  languages: union("lang", "Languages").map(l => l.replaceAll("_", "-")),
  scripts: union("lang", "Scripts"),
  variants: union("lang", "Variants").map(v => v.toLowerCase()),
  regions: union("region", "Countries"),
  currencies: union("curr", "Currencies"),
  keys: keys(langEn.Keys),
  types: Object.fromEntries(keys(langEn.Types).map(k => [k, keys((langEn.Types as any)[k])])),
});

// ─── Canonicalization ───

const metadata = bundle("misc/metadata.txt");
const alias = metadata.alias as { [key: string]: Res };
const keyTypeData = bundle("misc/keyTypeData.txt");
const nested = (res: Res | undefined) => Object.fromEntries(keys(res).map(k => [k, keys((res as any)[k])]));
save("aliases", {
  language: keys(alias.language).map(l => l.replaceAll("_", "-")),
  script: keys(alias.script),
  territory: keys(alias.territory),
  variant: keys(alias.variant).map(v => v.toLowerCase()),
  subdivision: keys(alias.subdivision),
  keyMap: Object.entries(keyTypeData.keyMap as object).flat(),
  typeMap: Object.fromEntries(
    keys(keyTypeData.typeMap).map(k => [k, Object.entries((keyTypeData.typeMap as any)[k]).flat()]),
  ),
  typeAlias: nested(keyTypeData.typeAlias),
  bcpTypeAlias: nested(keyTypeData.bcpTypeAlias),
});

// What has a likely script or region. The data has it as a trie of bytes (bytestrie.h): a language, a script and a region,
// each with the top bit set in its last letter, or * for any.
function keysOf(trie: Uint8Array) {
  const found: number[][] = [];
  const value = (pos: number, lead: number) =>
    lead < 0x51 ? 0 : lead < 0x6c ? 1 : lead < 0x7e ? 2 : lead === 0x7e ? 3 : 4;
  const number = (pos: number, lead: number) => {
    const n = value(pos, lead);
    let v = n === 0 ? lead - 0x10 : n === 1 ? lead - 0x51 : n === 2 ? lead - 0x6c : 0;
    for (let i = 0; i < n; i++) v = v * 256 + trie[pos + i];
    return v;
  };
  const jump = (pos: number): [target: number, after: number] => {
    const d = trie[pos++];
    const n = d < 0xc0 ? 0 : d < 0xf0 ? 1 : d < 0xfe ? 2 : d === 0xfe ? 3 : 4;
    let v = n === 0 ? d : n === 1 ? d - 0xc0 : n === 2 ? d - 0xf0 : 0;
    for (let i = 0; i < n; i++) v = v * 256 + trie[pos + i];
    return [pos + n + v, pos + n];
  };
  const branch = (pos: number, length: number, key: number[]) => {
    while (length > 5) {
      const [less, after] = jump(pos + 1);
      branch(less, length >> 1, key);
      length -= length >> 1;
      pos = after;
    }
    for (; length > 1; length--) {
      const byte = trie[pos++];
      const lead = trie[pos++];
      if (lead & 1) found.push([...key, byte]);
      else walk(pos + value(pos, lead >> 1) + number(pos, lead >> 1), [...key, byte]);
      pos += value(pos, lead >> 1);
    }
    walk(pos + 1, [...key, trie[pos]]);
  };
  const walk = (pos: number, key: number[]) => {
    for (;;) {
      const node = trie[pos++];
      if (node < 0x10) return branch(node === 0 ? pos + 1 : pos, (node === 0 ? trie[pos] : node) + 1, key);
      if (node < 0x20) {
        key = [...key, ...trie.subarray(pos, pos + node - 0x10 + 1)];
        pos += node - 0x10 + 1;
      } else {
        found.push(key);
        if (node & 1) return;
        pos += value(pos, node >> 1);
      }
    }
  };
  walk(0, []);
  return found;
}
const likelyTrie = Uint8Array.fromHex(
  /likely\{[^]*?trie:bin\{([0-9a-fA-F\s]*)\}/
    .exec(readFileSync(join(data, "misc/langInfo.txt"), "utf8"))![1]
    .replace(/\s+/g, ""),
);
save(
  "likely",
  [
    ...new Set(
      keysOf(likelyTrie).map(key => {
        const subtags = String.fromCharCode(
          ...key.flatMap(b => (b === 0x2a ? [0x2a, 0x2d] : b & 0x80 ? [b & 0x7f, 0x2d] : [b])),
        ).split("-");
        return [subtags[0] === "*" ? "und" : subtags[0], ...subtags.slice(1).filter(t => t && t !== "*")].join("-");
      }),
    ),
  ].join(" "),
);

// ─── Time zones ───

const zoneinfo = bundle("misc/zoneinfo64.txt");
const timezoneTypes = bundle("misc/timezoneTypes.txt");
const zoneIds = new Set<string>(zoneinfo.Names as string[]);
for (const table of ["typeMap", "typeAlias"]) {
  for (const k of keys((timezoneTypes[table] as any)?.timezone)) zoneIds.add(k.replaceAll(":", "/"));
}
for (const k of keys(bundle("misc/windowsZones.txt").mapTimezones)) zoneIds.add(k);
save("zones", [...zoneIds].sort());

// A zone's names come from its metazone, and which that is has changed over time: two instants, half a year apart
// where there is room, inside each period a zone spent in a metazone.
const periods: Record<string, number[]> = {};
for (const [zone, list] of Object.entries(bundle("misc/metaZones.txt").metazoneInfo as Record<string, Res>)) {
  const entries = (Array.isArray(list) && Array.isArray(list[0]) ? list : [list]) as Res[];
  if (entries.length < 2) continue;
  const instants: number[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const from = Date.parse((entry[1] as string).replace(" ", "T") + "Z");
    const to = Math.min(Date.parse((entry[2] as string).replace(" ", "T") + "Z"), Date.UTC(2030, 0, 1));
    const step = Math.min((to - from) / 3, 182 * 86400000);
    instants.push(Math.round(from + step), Math.round(from + 2 * step));
  }
  periods[zone.replaceAll(":", "/")] = instants;
}
save("zonePeriods", periods);

// A metazone's names are the same for every zone in it, so one zone stands for it: the one that, while it was in it, went
// by the most names, at an instant for each. Which those are is a matter of the zone's rules, so it is asked, in English.
const metazones: Record<string, [zone: string, ...instants: number[]]> = {};
for (const [id, list] of Object.entries(bundle("misc/metaZones.txt").metazoneInfo as Record<string, Res>)) {
  const zone = id.replaceAll(":", "/");
  const name = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "long", year: "numeric" });
  for (const entry of (Array.isArray(list) && Array.isArray(list[0]) ? list : [list]) as string[][]) {
    // Before 1970 no zone is in any metazone.
    const from =
      entry.length < 3
        ? Date.UTC(1970, 0, 2)
        : Math.max(Date.parse(entry[1].replace(" ", "T") + "Z"), Date.UTC(1970, 0, 2));
    const to =
      entry.length < 3
        ? Date.UTC(2030, 0, 1)
        : Math.min(Date.parse(entry[2].replace(" ", "T") + "Z"), Date.UTC(2030, 0, 1));
    const names = new Map<string, number>();
    // The latest first: names are for now, and what is long ago may be shown as an offset.
    let z: Temporal.ZonedDateTime | null = Temporal.Instant.fromEpochMilliseconds(to - 86400000).toZonedDateTimeISO(
      zone,
    );
    for (let i = 0; i < 40 && z && z.epochMilliseconds >= from; i++, z = z.getTimeZoneTransition("previous")) {
      const t = Math.min(z.epochMilliseconds + 86400000, to - 3600000);
      names.getOrInsert(name.formatToParts(t).find(p => p.type === "timeZoneName")!.value, t);
    }
    if (names.size > (metazones[entry[0]]?.length ?? 0) - 1) metazones[entry[0]] = [zone, ...names.values()];
  }
}
save("metazones", metazones);
// By locale, what its own bundle has names for, a metazone or a zone, and which: long or short, standard, daylight or
// generic, or the zone's city. The bundles of many locales have the same, so a locale has the number of a list.
const lists = new Map<string, number>();
save(
  "zoneNames",
  Object.fromEntries(
    stems("zone").flatMap(stem => {
      const locale = toBcp47(stem);
      if (stem === "tzdbNames" || !locale) return [];
      const list = Object.entries((bundle(`zone/${stem}.txt`).zoneStrings ?? {}) as Record<string, Res>)
        .filter(([name]) => name.includes(":"))
        .map(([name, names]) => `${name.replace(/^meta:/, "@").replaceAll(":", "/")} ${keys(names).join(" ")}`);
      return [[locale, lists.getOrInsert(list.join("\n"), lists.size)]];
    }),
  ),
);
save("zoneNameLists", [...lists.keys()]);

// What is in a locale's own bundle. The rest it has from its parents, where it is asked about.
const own = (table: string) =>
  Object.fromEntries(
    stems("locales").flatMap(stem => {
      const locale = toBcp47(stem);
      const found = keys(bundle(`locales/${stem}.txt`)[table]).filter(k => /^[a-z0-9-]+$/.test(k));
      return locale && found.length ? [[locale, found]] : [];
    }),
  );
save("calendars", own("calendar"));
// The skeletons that a calendar has a pattern for in a locale's own bundle, for a date and for a range of dates.
const skeletonLists = new Map<string, number>();
save(
  "skeletons",
  Object.fromEntries(
    stems("locales").flatMap(stem => {
      const locale = toBcp47(stem);
      return Object.entries(
        locale ? ((bundle(`locales/${stem}.txt`).calendar ?? {}) as Record<string, any>) : {},
      ).flatMap(([calendar, has]) => {
        const list = `${keys(has.availableFormats).join(" ")}|${keys(has.intervalFormats).join(" ")}`;
        return list === "|" ? [] : [[`${locale}/${calendar}`, skeletonLists.getOrInsert(list, skeletonLists.size)]];
      });
    }),
  ),
);
save("skeletonLists", [...skeletonLists.keys()]);
save("numberElements", own("NumberElements"));

// The numbering systems that have rules and no digits.
save(
  "algorithmicNumbers",
  Object.entries(
    (bundle("misc/numberingSystems.txt").numberingSystems ?? {}) as Record<string, { algorithmic: unknown }>,
  )
    .filter(([, system]) => String(system.algorithmic) === "1")
    .map(([name]) => name),
);

// The middle of each era of the Japanese calendar. Not its first days: the old ones start by the Julian calendar.
save(
  "japaneseEras",
  Object.values(
    (bundle("misc/supplementalData.txt").calendarData as any).japanese.eras as Record<string, { start: number[] }>,
  )
    .map(({ start: [year, month, day] }) => new Date(0).setUTCFullYear(year, month - 1, day))
    .sort((a, b) => a - b)
    .map((start, i, starts) => Math.round((start + (starts[i + 1] ?? start + 4e10)) / 2)),
);

// ─── Units: every identifier the data has a name for ───

const unitsEn = bundle("unit/en.txt").units as Record<string, Res>;
const unitIds = new Set<string>();
for (const category of keys(unitsEn)) for (const unit of keys(unitsEn[category])) unitIds.add(unit);
save("unitIds", [...unitIds].sort());

// ─── Collation: every string a tailoring mentions ───

/** The characters of a list in which a-d stands for a, b, c and d. */
const list = (text: string) => {
  const points = [...text];
  const found: string[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i] === "-" && i > 0 && i + 1 < points.length) {
      for (let c = points[i - 1].codePointAt(0)! + 1; c < points[i + 1].codePointAt(0)!; c++)
        found.push(String.fromCodePoint(c));
    } else {
      found.push(points[i]);
    }
  }
  return found;
};

/** The rules of a collation type, with those that they import in their place. */
const withImports = (stem: string, type: string): string =>
  ((bundle(`coll/${stem}.txt`).collations as any)[type].Sequence as string).replace(
    /\[import ([a-zA-Z-]+?)(?:-u-co-([a-z-]+))?\]/g,
    (_, locale: string, imported = "standard") =>
      withImports(
        locale === "und" ? "root" : locale.replaceAll("-", "_"),
        { phonebk: "phonebook", dict: "dictionary", trad: "traditional" }[imported as string] ?? imported,
      ),
  );
const tailored: Record<string, Record<string, string[]>> = {};
for (const stem of stems("coll")) {
  const collations = bundle(`coll/${stem}.txt`).collations;
  for (const type of keys(collations)) {
    if (typeof (collations as any)[type].Sequence !== "string") continue;
    const rules = withImports(stem, type);
    const found = new Set<string>();
    // What is to have no contractions, or to be fast, is mapped for that.
    for (const [, set] of rules.matchAll(/\[(?:suppressContractions|optimize)\s*\[([^\]]*)\]\s*\]/g)) {
      for (const c of list(set.replace(/\s+/g, ""))) found.add(c);
    }
    // Reset and relation operators separate the strings; `<*` and friends introduce a list of single characters.
    for (const part of rules.replace(/\[[^\]]*\]/g, " ").split(/(?=&|<<<\*?|<<\*?|<\*?|=\*?)/)) {
      const m = /^(&|<<<\*?|<<\*?|<\*?|=\*?)\s*([^]*)$/.exec(part);
      if (!m) continue;
      // '' is an apostrophe, and what is between two others is as it is. Marks of direction are white space.
      const text = m[2]!
        .replaceAll("''", "\0")
        .replace(/'([^']*)'/g, "$1")
        .replaceAll("\0", "'")
        .replace(/[\s\u200e\u200f]+/g, "");
      if (m[1]!.endsWith("*")) for (const c of list(text)) found.add(c);
      // prefix|string/extension: each, and the string where it has that before it.
      else
        for (const piece of [...text.split(/[|/]/), text.replace(/\/.*/, "").replace("|", "")])
          if (piece) found.add(piece);
    }
    const locale = toBcp47(stem);
    // A rule string that others import, which is no collation type.
    if (locale === undefined || type.startsWith("private-")) continue;
    (tailored[locale] ??= {})[{ phonebook: "phonebk", dictionary: "dict", traditional: "trad" }[type] ?? type] = [
      ...found,
    ];
  }
}
// The root has no rules. What it maps as a whole, or in a context, is in the table it is made from.
(tailored.und ??= {}).standard = readFileSync(join(source, "data/unidata/FractionalUCA.txt"), "utf8")
  .split("\n")
  .flatMap(line => /^([0-9A-F]{4,6}(?:[ |]+[0-9A-F]{4,6})+);/.exec(line)?.[1] ?? [])
  .map(hex => String.fromCodePoint(...hex.split(/[ |]+/).map(h => parseInt(h, 16))))
  .filter(s => s.isWellFormed());
save("tailored", tailored);

// ─── Characters ───

// What has a decomposition, which a slow build takes long to find out.
const decomposable: string[] = [];
for (let c = 0; c <= 0x10ffff; c++) {
  if (c >= 0xd800 && c <= 0xdfff) continue;
  // Hangul syllables are a matter of arithmetic.
  if (c >= 0xac00 && c <= 0xd7a3) continue;
  const s = String.fromCodePoint(c);
  if (s.normalize("NFD") !== s) decomposable.push(s);
}
save("decomposable", decomposable.join(""));
// One in seven of the characters that are not ideographs or syllables, of which there are many that sort as they are numbered.
const background: string[] = [];
for (let c = 0, i = 0; c <= 0x10ffff; c++) {
  if (c >= 0xd800 && c <= 0xdfff) continue;
  const s = String.fromCodePoint(c);
  if (
    /\p{Assigned}/u.test(s) &&
    !/[\p{Script=Han}\p{Script=Hangul}\p{Script=Tangut}\p{Script=Nushu}\p{Script=Khitan_Small_Script}\p{Co}]/u.test(
      s,
    ) &&
    i++ % 7 === 0
  )
    background.push(s);
}
save("background", background.join(""));

// ─── Corpora ───

const lines = (path: string) => readFileSync(join(source, path), "utf8").split("\n");
const fromHex = (hex: string) =>
  String.fromCodePoint(
    ...hex
      .trim()
      .split(/\s+/)
      .map(h => parseInt(h, 16)),
  );

const wordCounts: Record<string, number> = {};
save("wordCounts", wordCounts);
for (const dict of stems("brkitr/dictionaries")) {
  const words = lines(`data/brkitr/dictionaries/${dict}.txt`)
    .map(l =>
      l
        .replace(/^\ufeff/, "")
        .replace(/#.*/, "")
        .split("\t")[0]!
        .trim(),
    )
    .filter(Boolean);
  files["words/" + dict] = packWords([...new Set(words)].sort());
  wordCounts[dict] = new Set(words).size;
}

const breakTests = Object.fromEntries(
  ["Grapheme", "Word", "Sentence"].map(kind => [
    kind.toLowerCase(),
    lines(`test/testdata/${kind}BreakTest.txt`)
      .map(l => l.replace(/#.*/, "").replace(/[÷×]/g, " ").trim())
      .filter(Boolean)
      .map(fromHex),
  ]),
);
save("breakTests", breakTests);

// A character of each class that the rules have. Unicode's tests have one of each of Unicode's, and ICU has more, one of
// them for a single character. Two are of a class if they make the same difference between any two of the tests' characters.
const breakClasses = Object.fromEntries(
  ["grapheme/en", "word/en", "sentence/en", "sentence/el"].map(rules => {
    const [granularity, locale] = rules.split("/") as ["grapheme", string];
    const segmenter = new Intl.Segmenter(locale, { granularity });
    const some = [...new Set(breakTests[granularity].flatMap(t => [...t]))];
    const classes = new Map<string, string>();
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const s = String.fromCodePoint(c);
      if (!/\p{Assigned}/u.test(s) || /\p{Co}/u.test(s)) continue;
      let cuts = "";
      for (const { index, isWordLike } of segmenter.segment(some.map(x => x + s + x + s + s + x).join("\n")))
        cuts += index - cuts.length + (isWordLike ? "w" : ",");
      classes.getOrInsert(s.length + cuts, s);
    }
    // What goes on to a dictionary is of a class of its own, which makes no difference between two others.
    return [rules, [...new Set([...classes.values(), ..."\u0e01\u0e31\u3041\u30a1\u4e00"])].join("")];
  }),
);
save("breakClasses", breakClasses);
// A few surroundings that between them tell a character of any class from one of any other, as far as anything does.
save(
  "breakContexts",
  Object.fromEntries(
    Object.entries(breakClasses).map(([rules, classes]) => {
      const [granularity, locale] = rules.split("/") as ["grapheme", string];
      const segmenter = new Intl.Segmenter(locale, { granularity });
      const some = [...classes];
      const cuts = (text: string) =>
        Array.from(segmenter.segment(text), s => s.index + (s.isWordLike ? "w" : "")).join();
      // Positions are counted in UTF-16 units, so what is compared has to be as long.
      const candidates = some
        .flatMap(x =>
          some.flatMap(y => [
            [x, y],
            [x + x, y],
            [x, y + y],
          ]),
        )
        .map(([before, after]) => ({
          before,
          after,
          answers: some.map(c => c.length + cuts(before + c + after)),
        }));
      let apart = some.map(() => "");
      const groups = (labels: string[]) => new Set(labels).size;
      const chosen: string[][] = [];
      for (;;) {
        let best: (typeof candidates)[0] | undefined,
          most = groups(apart);
        for (const candidate of candidates) {
          const n = groups(apart.map((label, i) => label + "|" + candidate.answers[i]));
          if (n > most) [best, most] = [candidate, n];
        }
        if (!best) break;
        apart = apart.map((label, i) => label + "|" + best!.answers[i]);
        chosen.push([best.before, best.after]);
      }
      return [rules, chosen];
    }),
  ),
);

save(
  "emojiSequences",
  ["emoji-sequences.txt", "emoji-zwj-sequences.txt"].flatMap(file =>
    lines(`data/unidata/${file}`)
      .map(l => l.replace(/#.*/, "").split(";")[0]!.trim())
      .filter(l => l && !l.includes(".."))
      .map(fromHex),
  ),
);

save(
  "normalizationTest",
  lines("data/unidata/NormalizationTest.txt")
    .filter(l => /^[0-9A-F]/.test(l))
    .map(l => fromHex(l.split(";")[0]!)),
);

save(
  "idnaTest",
  lines("test/testdata/IdnaTestV2.txt")
    .map(l => l.replace(/#.*/, "").split(";")[0]!.trim())
    .filter(Boolean)
    .map(s =>
      s
        .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16))),
    ),
);

files["inputs.json"] = JSON.stringify(inputs);
await writeFixtures(files);
for (const [name, text] of Object.entries(files)) console.log(name, text.length);
