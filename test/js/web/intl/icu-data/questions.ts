// What is asked of ICU's data, through the APIs that anybody uses. Each section is about some part of the data
// and asks for every piece of it once, rather than for everything an API can do.
import type { Inputs } from "./fixtures";

type Add = ((value: unknown) => void) & {
  /** The result, or how it failed: an API that starts throwing is a difference. */
  try(fn: () => unknown): void;
};

interface Section {
  /** What has answers of its own, and a hash of them among the expected ones. */
  subjects(inputs: Inputs): string[];
  ask(subject: string, add: Add, inputs: Inputs): void;
}

export function answer(section: string, subjects: string[], inputs: Inputs): [key: string, hash: string][] {
  return subjects.map(subject => {
    const hasher = new Bun.CryptoHasher("sha256");
    const add = ((value: unknown) => {
      hasher.update(typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined"));
      hasher.update("\0");
    }) as Add;
    add.try = fn => {
      try {
        add(fn());
      } catch (e: any) {
        add(`!${e?.name}: ${e?.message}`);
      }
    };
    // Not add.try(): what fails as a whole has asked nothing, and would go on to say the same of any data.
    sections[section].ask(subject, add, inputs);
    return [`${section}/${subject}`, hasher.digest("hex").slice(0, 16)];
  });
}

const DAY = 86400000;
const WIDTHS = ["long", "short", "narrow"] as const;
const supported = (key: Parameters<typeof Intl.supportedValuesOf>[0]) => Intl.supportedValuesOf(key);
const parts = (list: { type: string; value: string; source?: string }[]) =>
  list.map(p => `${p.type}${p.source ? "@" + p.source : ""}=${p.value}`).join("|");
/** What a formatter makes of each value, and of the first also which part of it is what: that takes data of its own. */
const shown = <T>(
  f: { format(value: T): string; formatToParts(value: T): Parameters<typeof parts>[0] },
  values: readonly T[],
) => [...values.map(v => f.format(v)), parts(f.formatToParts(values[0]))];
/** What fn makes of each, or how it failed, as one answer. */
const each = <T>(list: readonly T[], fn: (item: T) => unknown) =>
  list
    .map(item => {
      try {
        return fn(item) ?? "∅";
      } catch (e: any) {
        return `!${e?.name}: ${e?.message}`;
      }
    })
    .join("\u0001");

/** A number for each plural category that the locale has, which is what selects among the forms of a unit or a currency. */
function numbers(locale: string) {
  const rules = new Intl.PluralRules(locale);
  const found = new Map<string, number>();
  for (const n of [1, 2, 0, 3, 6, 11, 5, 20, 21, 100, 1000000, 1.5, 0.5]) found.getOrInsert(rules.select(n), n);
  return [...found.values()];
}

/** Blocks of code points, as subjects. */
const blocks = () => Array.from({ length: 0x110000 / 0x800 }, (_, i) => (i * 0x800).toString(16));
const block = (subject: string) => {
  const start = parseInt(subject, 16);
  return codePoints(() => true, start, start + 0x800);
};

const codePoints = (filter: (c: number) => boolean, from = 0, to = 0x110000) => {
  const all: string[] = [];
  for (let c = from; c < to; c++) if ((c < 0xd800 || c > 0xdfff) && filter(c)) all.push(String.fromCodePoint(c));
  return all;
};
const isAssigned = (c: number) => /\p{Assigned}/u.test(String.fromCodePoint(c));
let assigned: string[] | undefined;

/** By what they decompose to, the characters that decompose. By a letter, the marks that some character has on it. */
let spellings: Map<string, string[]> | undefined, marksOn: Map<string, string[][]>;

/**
 * Other spellings of a string that is mapped as a whole, and of it with more marks, which are mapped as a whole too.
 * With cs there are c and each of ś ŝ ş š …; with ä there is ą and a diaeresis; with any acute accent there is U+0341.
 */
function closure(mapped: string, inputs: Inputs) {
  if (!spellings) {
    [spellings, marksOn] = [new Map(), new Map()];
    for (const c of inputs.decomposable as string) {
      const decomposed = c.normalize("NFD");
      spellings.getOrInsertComputed(decomposed, () => []).push(c);
      const [first, ...marks] = decomposed;
      // Not the vowel of a Hangul syllable.
      if (marks.length && /^\p{M}+$/u.test(marks.join(""))) marksOn.getOrInsertComputed(first, () => []).push(marks);
    }
  }
  // Rules spell the same letter either way.
  const points = [...mapped.normalize("NFD")];
  const letter = Math.max(
    0,
    points.findLastIndex(c => !/\p{M}/u.test(c)),
  );
  const [head, last, marks] = [points.slice(0, letter), points[letter], points.slice(letter + 1)];
  const sequences = [[...head, last, ...marks]];
  for (const more of marksOn.get(last) ?? []) {
    if (head.length) sequences.push([...head, last, ...more]);
    if (marks.length) sequences.push([...head, last, ...more, ...marks]);
  }
  // A mark can have marks too.
  if (marks.length) for (const more of marksOn.get(marks.at(-1)!) ?? []) sequences.push([...points, ...more]);
  const found = new Set<string>();
  const respell = (sequence: string[], again: boolean) => {
    found.add(sequence.join(""));
    for (let i = 0; i < sequence.length; i++) {
      for (let j = i + 1; j <= Math.min(i + 3, sequence.length); j++) {
        for (const c of spellings!.get(sequence.slice(i, j).join("")) ?? []) {
          const other = sequence.toSpliced(i, j - i, c);
          if (again) respell(other, false);
          else found.add(other.join(""));
        }
      }
    }
  };
  for (const sequence of sequences) respell(sequence, true);
  return found;
}

/** The strings, in every spelling, by themselves and next to something. */
function contexts(mapped: string[], inputs: Inputs) {
  const found: string[] = [];
  for (const m of mapped) {
    for (const s of [m, ...closure(m, inputs)]) found.push(s, s + "a", "a" + s, s + s);
    // What starts the same and goes on otherwise: a comparison that skips what is the same has to know to go back.
    const points = [...m];
    if (points.length < 2) continue;
    const [start, last] = [points.slice(0, -1).join(""), points.at(-1)!.codePointAt(0)!];
    for (const d of [-2, -1, 1, 2, 3])
      if (last + d > 0 && (last + d < 0xd800 || last + d > 0xdfff)) found.push(start + String.fromCodePoint(last + d));
    found.push(start + "a", start + "z", start + "\u0301", start + "\u0323");
  }
  return found;
}
let ofTheRoot: string[] | undefined;

/** The order, and which neighbours are the same to the collator: sorting keeps those in the order they came in. */
function addOrder(add: Add, strings: string[], compare: (a: string, b: string) => number) {
  strings.sort(compare);
  add(strings.join("\u0001"));
  let same = "";
  for (let i = 1; i < strings.length; i++) if (compare(strings[i - 1], strings[i]) === 0) same += i + ",";
  add(same);
}

/** Lets go of what a section has worked out once for all its subjects. */
export function forget(inputs: Inputs) {
  assigned = spellings = ofTheRoot = undefined;
  inputs.words();
}

export const sections: Record<string, Section> = {
  // Collation is an order, so what is asked for is the order of everything.
  "collation": {
    subjects: inputs =>
      Object.entries(inputs.tailored as Record<string, Record<string, string[]>>).flatMap(([locale, types]) =>
        Object.keys(types).map(type => `${locale}/${type}`),
      ),
    ask(subject, add, inputs) {
      const [locale, type] = subject.split("/");
      const options = (type === "search" ? { usage: "search" } : { collation: type }) as Intl.CollatorOptions;
      const collator = new Intl.Collator(locale, options);
      add(collator.resolvedOptions());
      // What the tailoring's rules mention, which has the strings that are mapped as a whole, in some contexts.
      // And what the root maps as a whole: a tailoring that maps how one of those starts has its own copy of it.
      const mentioned: string[] = inputs.tailored[locale][type];
      // The order of everything is the root's, and is asked for once. A tailoring's is that of what it maps among some of the
      // rest, and among what is next to it: it has a bit for each 256 characters, and for each, that says whether it maps any.
      const among = new Set<string>(
        locale === "und" && type === "standard" ? codePoints(() => true) : inputs.background,
      );
      // The table for two strings of Latin letters has these, and some punctuation, which it is asked about only after the
      // strings have started to differ by a letter.
      const latin = codePoints(() => true, 0, 0x180);
      for (const p of codePoints(() => true, 0x2000, 0x2040)) latin.push(p, `a${p}b`, `A${p}b`, `a${p}`, `\u00e1${p}`);
      for (const s of latin) among.add(s);
      const characters = new Set(mentioned.flatMap(m => [...m, ...m.normalize("NFD")]));
      // What is made of them is mapped too: letters with marks, and Hangul syllables, which are made of jamo.
      const made = [...(inputs.decomposable as string)].filter(c =>
        [...c.normalize("NFD")].some(part => characters.has(part)),
      );
      for (const c of made) characters.add(c);
      if (mentioned.some(m => /[\u1100-\u11ff]/.test(m)))
        for (let c = 0xac00; c <= 0xd7a3; c += 256) characters.add(String.fromCharCode(c));
      for (const start of new Set([...characters].map(c => c.codePointAt(0)! & ~255))) {
        for (const s of codePoints(() => true, start, start + 256)) among.add(s);
      }
      // ǖ is ü with a macron, and where ü is mapped so is every spelling of that.
      const decomposed = new Set(mentioned.map(m => m.normalize("NFD")));
      const extended = made.filter(c => {
        const parts = [...c.normalize("NFD")];
        return parts.some((_, i) => i > 1 && decomposed.has(parts.slice(0, i).join("")));
      });
      const inContext = new Set((ofTheRoot ??= contexts(inputs.tailored.und.standard, inputs)));
      for (const s of contexts([...mentioned, ...extended], inputs)) inContext.add(s);
      addOrder(add, [...inContext.union(among)], collator.compare);
      // What counts as punctuation is a matter of the data.
      addOrder(
        add,
        latin,
        new Intl.Collator(locale, {
          ...options,
          ignorePunctuation: !collator.resolvedOptions().ignorePunctuation,
        }).compare,
      );
      // Two strings of Latin letters are compared by a table that is only for those, unless digits count as numbers.
      for (let c = 0; c < 0x250; c++) inContext.add(String.fromCharCode(c));
      for (let c = 0x2000; c < 0x2040; c++) inContext.add(String.fromCharCode(c));
      addOrder(add, [...inContext], new Intl.Collator(locale, { ...options, numeric: true }).compare);
    },
  },

  // A dictionary is a trie of words. Run together, each is looked for where it starts, and so is every start of it.
  "dictionaries": {
    subjects: inputs =>
      Object.entries(inputs.wordCounts).flatMap(([dictionary, count]) =>
        Array.from({ length: Math.ceil(count / 1000) }, (_, i) => `${dictionary}/${i}`),
      ),
    ask(subject, add, inputs) {
      const [dictionary, i] = subject.split("/");
      const locale = { cjdict: "ja", thaidict: "th", laodict: "lo", khmerdict: "km", burmesedict: "my" }[dictionary];
      const words = inputs.words(dictionary).slice(Number(i) * 1000, (Number(i) + 1) * 1000);
      // In a row, where it takes the others to tell where one ends. And apart: but for Chinese and Japanese, a word is
      // looked for only where the one before is thought to end.
      for (const text of [words.join(""), words.join(" ")]) {
        let cuts = "";
        for (const s of new Intl.Segmenter(locale, { granularity: "word" }).segment(text))
          cuts += s.index + (s.isWordLike ? "w" : "n");
        add(cuts);
      }
    },
  },

  // Rules are a table from each character to its class, and a state machine over the classes.
  "break rules": {
    subjects: inputs =>
      // Greek has sentence rules of its own.
      ["grapheme/en", "word/en", "sentence/en", "sentence/el"].flatMap(rules =>
        [
          ...blocks(),
          "conformance",
          "at random",
          ...[...(inputs.breakClasses[rules] as string)].map((_, i) => `after ${i}`),
        ].map(s => `${rules}/${s}`),
      ),
    ask(subject, add, inputs) {
      const [granularity, locale, what] = subject.split("/") as ["grapheme" | "word" | "sentence", string, string];
      const segmenter = new Intl.Segmenter(locale, { granularity });
      const cuts = (text: string) => {
        let found = "";
        for (const s of segmenter.segment(text)) found += s.index + (s.isWordLike ? "w" : "") + ",";
        return found;
      };
      const tests: string[] = inputs.breakTests[granularity];
      if (what === "conformance") return add(each(tests, cuts));
      if (/^[0-9a-f]+$/.test(what)) {
        // In surroundings that tell each class from every other. What is not assigned is all of one class.
        const contexts: [string, string][] = inputs.breakContexts[`${granularity}/${locale}`];
        add(
          cuts(
            block(what)
              .map(c => `${c}a${c}. ${c}`)
              .join(""),
          ),
        );
        return add(
          cuts(
            block(what)
              .filter(c => isAssigned(c.codePointAt(0)!))
              .flatMap(c => contexts.map(([before, after]) => before + c + after))
              .join("\n"),
          ),
        );
      }
      // Any four characters in a row, of one of each class, get the machine into each of its states and out of it.
      const some = [...(inputs.breakClasses[`${granularity}/${locale}`] as string)];
      if (what.startsWith("after ")) {
        const a = some[Number(what.slice("after ".length))];
        return add(cuts(some.flatMap(b => some.flatMap(c => some.map(d => a + b + c + d))).join("\n")));
      }
      let seed = 1;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) >> 8;
      const text = Array.from({ length: 600000 }, () => some[random() % some.length]).join("");
      add(cuts(text));
      // Asking about a place in the middle has it go backwards to somewhere safe.
      const segments = segmenter.segment(text);
      let found = "";
      for (let i = 7; i < text.length; i += 97) found += segments.containing(i)!.index + ",";
      add(found);
    },
  },

  // ─── The trees of names ───

  "language names": {
    subjects: inputs => inputs.trees.lang,
    ask(locale, add, { codes }) {
      const names = (options: Intl.DisplayNamesOptions) =>
        new Intl.DisplayNames(locale, { fallback: "none", ...options });
      for (const style of WIDTHS) {
        const language = names({ type: "language", style });
        add(each(codes.languages, tag => language.of(tag)));
        const script = names({ type: "script", style });
        add(each(codes.scripts, code => script.of(code)));
        const calendar = names({ type: "calendar", style });
        add(each([...supported("calendar"), ...(codes.types.calendar ?? [])], code => calendar.of(code)));
      }
      // Put together from the names of the parts, which for scripts are not the ones above.
      const standard = names({ type: "language", languageDisplay: "standard" });
      add(each(codes.variants, variant => standard.of(`en-${variant}`)));
      add(each(codes.scripts, script => standard.of(`zh-${script}`)));
      add(
        each(["en-GB", "zh-Hant-HK", "sr-Cyrl-RS", "en-Latn-US-fonipa-scouse", "xx", "und"], tag => standard.of(tag)),
      );
    },
  },

  "region names": {
    subjects: inputs => inputs.trees.region,
    ask(locale, add, { codes }) {
      for (const style of WIDTHS) {
        const region = new Intl.DisplayNames(locale, { type: "region", style, fallback: "none" });
        add(each(codes.regions, code => region.of(code)));
      }
    },
  },

  "currencies": {
    subjects: inputs => inputs.trees.curr,
    ask(locale, add, { codes }) {
      const currencies = codes.currencies.filter(c => /^[A-Z]{3}$/.test(c));
      for (const style of WIDTHS) {
        const name = new Intl.DisplayNames(locale, { type: "currency", style, fallback: "none" });
        add(each(currencies, code => name.of(code)));
      }
      const values = numbers(locale);
      add(
        each(currencies, currency => {
          // Without ",00": a number with decimals is of another category than the same without.
          const f = new Intl.NumberFormat(locale, {
            style: "currency",
            currency,
            currencyDisplay: "name",
            trailingZeroDisplay: "stripIfInteger",
          });
          return shown(f, values);
        }),
      );
      for (const currencyDisplay of ["symbol", "narrowSymbol", "code"] as const) {
        for (const currencySign of ["standard", "accounting"] as const) {
          add(
            each(["USD", "EUR", "JPY", "CHF", "INR", "XXX"], currency =>
              parts(
                new Intl.NumberFormat(locale, {
                  style: "currency",
                  currency,
                  currencyDisplay,
                  currencySign,
                }).formatToParts(-1234.5),
              ),
            ),
          );
        }
      }
    },
  },

  "units": {
    subjects: inputs => inputs.trees.unit,
    ask(locale, add) {
      const units = supported("unit");
      const values = numbers(locale);
      // One per another has a name of its own, or the second has a pattern for it, or the language has one for any two,
      // with the second in the case that the language asks for.
      const compound = [
        ...units.flatMap(u => [`${u}-per-second`, `${u}-per-hectare`, `meter-per-${u}`, `liter-per-${u}`]),
      ];
      // These have names of their own.
      const named = [
        ...units,
        "kilometer-per-hour",
        "mile-per-hour",
        "mile-per-gallon",
        "liter-per-kilometer",
        "meter-per-second",
      ];
      for (const unitDisplay of WIDTHS) {
        add(
          each(named, unit => {
            const f = new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay });
            return shown(f, values);
          }),
        );
        add(
          each(compound, unit =>
            parts(new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay }).formatToParts(2)),
          ),
        );
      }
      const duration = {
        years: 1,
        months: 2,
        weeks: 3,
        days: 4,
        hours: 5,
        minutes: 6,
        seconds: 7,
        milliseconds: 8,
        microseconds: 9,
        nanoseconds: 1,
      };
      for (const style of [...WIDTHS, "digital"] as const) {
        const f = new Intl.DurationFormat(locale, { style });
        add(
          each(
            [duration, { hours: 1, minutes: 2 }, { minutes: 1, seconds: 2 }, { hours: 1, minutes: 1, seconds: 1 }],
            d => parts(f.formatToParts(d)),
          ),
        );
      }
    },
  },

  "time zone names": {
    subjects: inputs => inputs.trees.zone,
    ask(locale, add, inputs) {
      const name = (timeZoneName: Intl.DateTimeFormatOptions["timeZoneName"], timeZone: string, instants: number[]) => {
        const f = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName, hour: "numeric" });
        return shown(f, instants);
      };
      const now = [1705000000000, 1720000000000];
      const kinds = {
        l: ["long"],
        s: ["short"],
        lg: ["longGeneric"],
        sg: ["shortGeneric"],
        ec: ["longGeneric", "shortGeneric"],
      } as const;
      add(
        each((inputs.zoneNameLists[inputs.zoneNames[locale]] as string).split("\n").filter(Boolean), line => {
          const [what, ...has] = line.split(" ");
          // A metazone's names are the same for every zone in it, so one stands for it, while it was in it.
          const [zone, ...instants] = what[0] === "@" ? inputs.metazones[what.slice(1)] : [what, ...now];
          // A zone is named after its city where its metazone has no name of the kind, if its country has more zones.
          return [...new Set(has.flatMap(k => kinds[k as "lg"] ?? kinds[k[0] as "l"]))].map(kind =>
            name(kind, zone, instants),
          );
        }),
      );
      // What is put together: from the name of a country, or from an offset.
      add(
        each(["Europe/Berlin", "America/Chicago", "Asia/Shanghai", "Pacific/Honolulu", "Etc/Unknown"], zone => [
          name("longGeneric", zone, now),
          name("shortGeneric", zone, now),
          name("long", zone, now),
          name("short", zone, now),
        ]),
      );
      for (const kind of ["shortOffset", "longOffset"] as const) {
        add(
          each(["UTC", "Asia/Kolkata", "America/St_Johns", "Asia/Tokyo", "America/New_York"], zone =>
            name(kind, zone, now),
          ),
        );
      }
    },
  },

  // ─── The main tree ───

  "calendars": {
    subjects: inputs =>
      Object.entries(inputs.calendars as Record<string, string[]>).flatMap(([locale, calendars]) =>
        calendars.filter(c => c !== "default").map(c => `${locale}/${c}`),
      ),
    ask(subject, add, inputs) {
      const [locale, its] = subject.split("/");
      // Nobody can ask for the generic calendar. It is what a calendar that the locale has nothing else for goes by.
      const calendar =
        { "gregorian": "gregory", "ethiopic-amete-alem": "ethioaa" }[its] ??
        (its !== "generic"
          ? its
          : ["coptic", "persian", "indian", "roc", "buddhist"].find(c => !inputs.calendars[locale].includes(c))!);
      const n = "numeric";
      const format = (options: Intl.DateTimeFormatOptions, instants: number[]) => {
        const f = new Intl.DateTimeFormat(locale, { calendar, timeZone: "UTC", ...options });
        return shown(f, instants);
      };
      // A step of 29 days through 14 months visits every month, and a leap month of the years that have one, and every weekday.
      // But for the month of five days that two calendars end the year with.
      const year = [...Array.from({ length: 30 }, (_, i) => 1670000000000 + i * 29 * DAY), Date.UTC(2023, 8, 8)];
      // Midnight and noon have names, on the minute.
      const hours = [
        ...Array.from({ length: 24 }, (_, i) => 1700000000000 + i * 3600000),
        Date.UTC(2023, 4, 10),
        Date.UTC(2023, 4, 10, 12),
      ];
      // Each side of the changes of era of the Japanese calendar, and of the others'.
      const eras = [
        -1e14, -62135596800001, -3218832000000, -1812153600000, -1357603200000, 600220800000, 1556668800000, 0, -5e13,
        -1.9e12,
      ];
      if (calendar === "japanese") eras.push(...inputs.japaneseEras);
      for (const w of WIDTHS) {
        add(
          each(
            [
              { month: w },
              { month: w, day: n },
              { weekday: w },
              { weekday: w, day: n },
              { month: w, year: n },
            ] as const,
            o => format(o, year),
          ),
        );
        add(
          each(
            [
              { era: w, year: n },
              { era: w, year: n, month: w, day: n },
            ] as const,
            o => format(o, eras),
          ),
        );
        add(
          each([{ dayPeriod: w }, { dayPeriod: w, hour: n }, { hour: n, hour12: true, weekday: w }] as const, o =>
            format(o, hours),
          ),
        );
      }
      // The years of a cycle of sixty have names.
      if (its === "chinese" || its === "dangi")
        add(
          format(
            { year: n, month: "long" },
            Array.from({ length: 60 }, (_, i) => Date.UTC(1984 + i, 5, 1)),
          ),
        );
      const styles = [undefined, "full", "long", "medium", "short"] as const;
      add(
        each(styles.flatMap(dateStyle => styles.map(timeStyle => ({ dateStyle, timeStyle }))).slice(1), o =>
          format(o, [1700000000000]),
        ),
      );
      // What the bundle has a pattern for, and what nothing has, which is put together.
      const [dates, ranges] = ((inputs.skeletonLists[inputs.skeletons[subject]] as string) ?? "|")
        .split("|")
        .map(list => list.split(" ").flatMap(k => optionsOf(k) ?? []));
      add(each([...dates, ...UNUSUAL], o => format(o, [1700000000000, 1700000000000 + 11 * 3600000])));
      add(
        each(ranges, o => {
          const f = new Intl.DateTimeFormat(locale, { calendar, timeZone: "UTC", ...o });
          return [
            ...RANGES.map(([start, end]) => f.formatRange(start, end)),
            ...[RANGES[1], RANGES[8]].map(([start, end]) => parts(f.formatRangeToParts(start, end))),
          ];
        }),
      );
    },
  },

  "numbers": {
    subjects: inputs =>
      Object.entries(inputs.numberElements as Record<string, string[]>).flatMap(([locale, systems]) =>
        systems
          .filter(
            s => !["default", "native", "traditional", "finance", "minimumGroupingDigits", "minimalPairs"].includes(s),
          )
          .map(s => `${locale}/${s}`),
      ),
    ask(subject, add) {
      const [locale, numberingSystem] = subject.split("/");
      const format = (options: Intl.NumberFormatOptions, values: (number | bigint)[]) => {
        const f = new Intl.NumberFormat(locale, { numberingSystem, ...options });
        return shown(f as Intl.NumberFormat & { format(v: number | bigint): string }, values);
      };
      const values = [-1234567.891, 0, 1234, 12345, NaN, Infinity];
      add(
        each(
          [
            {},
            { style: "percent" },
            { style: "currency", currency: "EUR" },
            { style: "currency", currency: "EUR", currencySign: "accounting" },
            { style: "currency", currency: "EUR", currencyDisplay: "name" },
            { style: "currency", currency: "EUR", currencyDisplay: "code" },
            { notation: "scientific" },
            { notation: "engineering", signDisplay: "always" },
            { signDisplay: "always" },
            { useGrouping: "min2" },
            { useGrouping: "always" },
          ] as const,
          o => format(o, values),
        ),
      );
      // A form for each power of ten and each plural category of what is left of the number.
      const few = numbers(locale).filter(v => v >= 1 && v < 100 && Number.isInteger(v));
      const powers = Array.from({ length: 21 }, (_, e) => few.map(v => v * 10 ** e)).flat();
      for (const compactDisplay of ["short", "long"] as const) {
        add(format({ notation: "compact", compactDisplay }, powers));
        add(format({ notation: "compact", compactDisplay, style: "currency", currency: "USD" }, powers));
      }
      const range = new Intl.NumberFormat(locale, { numberingSystem });
      add(
        each(
          [
            [3, 5],
            [-3, 12345],
            [2.9, 3.1],
            [3, 3],
          ] as const,
          ([a, b]) => parts(range.formatRangeToParts(a, b)),
        ),
      );
      add(
        each([[2.999, 3.001]] as const, ([a, b]) =>
          parts(new Intl.NumberFormat(locale, { numberingSystem, maximumFractionDigits: 0 }).formatRangeToParts(a, b)),
        ),
      );
      add(
        new Intl.DateTimeFormat(locale, {
          numberingSystem,
          dateStyle: "short",
          timeStyle: "medium",
          timeZone: "UTC",
        }).format(1700000000000),
      );
    },
  },

  "fields and lists": {
    subjects: inputs => inputs.trees.locales,
    ask(locale, add) {
      const values = numbers(locale).flatMap(v => [v, -v]);
      const units = ["second", "minute", "hour", "day", "week", "month", "quarter", "year"] as const;
      for (const style of WIDTHS) {
        const always = new Intl.RelativeTimeFormat(locale, { style });
        add(
          each(units, unit => [
            ...values.map(v => always.format(v, unit)),
            parts(always.formatToParts(values[0], unit)),
          ]),
        );
        const auto = new Intl.RelativeTimeFormat(locale, { style, numeric: "auto" });
        add(each(units, unit => [-3, -2, -1, 0, 1, 2, 3].map(v => auto.format(v, unit))));
        const field = new Intl.DisplayNames(locale, { type: "dateTimeField", style });
        add(
          each(
            [
              "era",
              "year",
              "quarter",
              "month",
              "weekOfYear",
              "weekday",
              "day",
              "dayPeriod",
              "hour",
              "minute",
              "second",
              "timeZoneName",
            ],
            f => field.of(f),
          ),
        );
        for (const type of ["conjunction", "disjunction", "unit"] as const) {
          const list = new Intl.ListFormat(locale, { type, style });
          // Spanish and Hebrew choose the conjunction by how the next word starts.
          add(
            each(
              [
                ["a", "b"],
                ["a", "b", "c", "d"],
                ["x", "iglesia"],
                ["x", "otro"],
                ["x", "8"],
                ["א", "b"],
              ],
              l => parts(list.formatToParts(l)),
            ),
          );
        }
      }
      add(new Intl.DateTimeFormat(locale).resolvedOptions());
      add(new Intl.NumberFormat(locale).resolvedOptions());
      add(
        each([1234.5, 12345678901234567890n, new Date(0)], v =>
          (v as Date).toLocaleString(locale, { timeZone: "UTC" }),
        ),
      );
    },
  },

  // ─── What is not by locale ───

  "plural rules": {
    subjects: inputs => [...new Set(inputs.trees.locales.map(l => l.split("-")[0])), "pt-PT", "xx"],
    ask(locale, add) {
      const values = [
        ...Array.from({ length: 221 }, (_, i) => i),
        1000,
        1001,
        10000,
        100000,
        1e6,
        2e6,
        1e6 + 1,
        1e9,
        1e12,
        0.1,
        0.5,
        1.1,
        1.5,
        2.1,
        10.1,
        0.01,
        1.01,
        1.21,
        100.5,
      ];
      for (const type of ["cardinal", "ordinal"] as const) {
        for (const options of [
          {},
          { minimumFractionDigits: 1 },
          { minimumFractionDigits: 2 },
          { notation: "compact" },
        ] as const) {
          const rules = new Intl.PluralRules(locale, { type, ...options });
          add(values.map(v => rules.select(v)[0]).join(""));
          add(rules.resolvedOptions().pluralCategories);
        }
      }
      const rules = new Intl.PluralRules(locale);
      const some = [0, 1, 2, 3, 5, 11, 21, 100, 101, 1e6, 1.5, 2.5];
      add(
        each(
          some.flatMap(a => some.filter(b => a <= b).map(b => [a, b])),
          ([a, b]) => (rules as Intl.PluralRules & { selectRange(a: number, b: number): string }).selectRange(a, b),
        ),
      );
    },
  },

  "locale information": {
    subjects({ codes, trees }) {
      const tags = new Set([...trees.locales, ...codes.languages]);
      for (const s of codes.scripts) tags.add(`und-${s}`);
      for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) tags.add(`und-${String.fromCharCode(a, b)}`);
      for (const r of codes.regions) for (const l of ["en", "ar", "zh", "sr"]) tags.add(`${l}-${r}`);
      const sorted = [...tags].sort();
      return Array.from({ length: Math.ceil(sorted.length / 100) }, (_, i) =>
        sorted.slice(i * 100, (i + 1) * 100).join(" "),
      );
    },
    ask(subject, add) {
      add(
        each(subject.split(" "), tag => {
          const l = new Intl.Locale(tag);
          return [
            l.maximize(),
            l.minimize(),
            ...(
              [
                "getCalendars",
                "getCollations",
                "getHourCycles",
                "getNumberingSystems",
                "getTimeZones",
                "getTextInfo",
                "getWeekInfo",
              ] as const
            ).map(m => JSON.stringify(l[m]())),
          ].join(" ");
        }),
      );
    },
  },

  "what is supported": {
    subjects: () => [
      ...["calendar", "collation", "currency", "numberingSystem", "timeZone", "unit"],
      ...[
        "Collator",
        "DateTimeFormat",
        "DisplayNames",
        "DurationFormat",
        "ListFormat",
        "NumberFormat",
        "PluralRules",
        "RelativeTimeFormat",
        "Segmenter",
      ],
    ],
    ask(subject, add, { trees }) {
      if (/^[a-z]/.test(subject)) return add(supported(subject as "unit"));
      const service = Intl[subject as "Collator"];
      const locales = [...new Set(Object.values(trees).flat())];
      for (const localeMatcher of ["lookup", "best fit"] as const)
        add(service.supportedLocalesOf(locales, { localeMatcher }));
      add(
        each(
          locales,
          l =>
            new service(l, (subject === "DisplayNames" ? { type: "region" } : undefined) as {}).resolvedOptions()
              .locale,
        ),
      );
    },
  },

  "canonical tags": {
    subjects: () => ["language", "script", "territory", "variant", "subdivision", "types", "type aliases", "others"],
    ask(subject, add, { aliases: a }) {
      const bcp47 = (key: string) => (key.length === 2 ? key : a.keyMap[a.keyMap.indexOf(key) + 1]);
      const tags: string[] = {
        "language": () => a.language.flatMap((l: string) => [l, `${l}-Latn`, `${l}-US`]),
        "script": () => a.script.map((s: string) => `und-${s}`),
        // What a country that is no more has become depends on the language.
        "territory": () =>
          a.territory.flatMap((t: string) => ["und", "ru", "hy", "az", "sr", "uz"].map(l => `${l}-${t}`)),
        "variant": () => a.variant.flatMap((v: string) => [`en-${v}`, `hy-${v}`, `ja-Latn-${v}`]),
        "subdivision": () => a.subdivision.flatMap((s: string) => [`en-u-sd-${s}`, `en-u-rg-${s}`]),
        "types": () =>
          Object.entries(a.typeMap as Record<string, string[]>).flatMap(([key, types]) =>
            [...new Set([key, bcp47(key) ?? key])]
              .filter(k => /^[a-z0-9]{2}$/.test(k))
              .flatMap(k => types.filter(t => /^[a-z0-9-]{3,}$/i.test(t)).map(t => `en-u-${k}-${t.toLowerCase()}`)),
          ),
        "type aliases": () =>
          [a.typeAlias, a.bcpTypeAlias].flatMap((table: Record<string, string[]>) =>
            Object.entries(table).flatMap(([key, types]) =>
              types.map(t => `en-u-${bcp47(key)}-${t.toLowerCase().replace(/[:_]/g, "-")}`),
            ),
          ),
        "others": () =>
          "en-t-hi-latn en-t-m0-names und-t-d0-ascii en-u-ca-islamicc en-u-tz-cnckg en-u-kn-true en-u-ks-primary art-lojban cel-gaulish zh-guoyu sgn-BE-FR no-bok en-GB-oed x-private en-x-a-b de-DE-1996-1901 sl-rozaj-biske-1994".split(
            " ",
          ),
      }[subject]!();
      add(each(tags, tag => Intl.getCanonicalLocales(tag)[0]));
    },
  },

  // What is turned down, or into something else, before ICU sees it. Bun's data leaves out what is behind these, so if
  // one of them were let through it would have another answer than ICU's own data gives.
  "what is refused": {
    subjects: () => ["the POSIX locale", "calendars", "numbering systems", "fields", "time zones"],
    ask(subject, add, inputs) {
      if (subject === "the POSIX locale") {
        add(
          each(["en-US-u-va-posix", "en-US-posix", "en-u-va-posix", "en-posix"], tag => [
            Intl.getCanonicalLocales(tag)[0],
            new Intl.Collator(tag).resolvedOptions().locale,
            ["a", "B", "b", "A", "_", "1"].sort(new Intl.Collator(tag).compare).join(""),
            Array.from(new Intl.Segmenter(tag, { granularity: "word" }).segment("a:b c.d 1,2"), s => s.segment).join(
              "|",
            ),
            new Intl.NumberFormat(tag).format(1234567.891),
            new Intl.NumberFormat(tag).format(Infinity),
            new Intl.DateTimeFormat(tag, { dateStyle: "full", timeStyle: "full", timeZone: "UTC" }).format(0),
          ]),
        );
      } else if (subject === "calendars") {
        add(
          each(["islamic-rgsa", "generic", "islamic", "islamicc"], calendar =>
            ["en", "ar", "und"].map(locale => {
              const f = new Intl.DateTimeFormat(locale, { calendar, dateStyle: "full", timeZone: "UTC" });
              return `${f.resolvedOptions().calendar} ${f.format(0)}`;
            }),
          ),
        );
      } else if (subject === "numbering systems") {
        add(
          each([...(inputs.algorithmicNumbers as string[]), "native", "traditio", "finance"], numberingSystem =>
            ["en", "zh-Hant", "ja", "he", "ar", "hi", "ta"].map(locale => [
              new Intl.NumberFormat(locale, { numberingSystem }).format(1234),
              new Intl.NumberFormat(`${locale}-u-nu-${numberingSystem}`).resolvedOptions().numberingSystem,
              new Intl.DateTimeFormat(locale, { numberingSystem, dateStyle: "long", timeZone: "UTC" }).format(0),
            ]),
          ),
        );
      } else if (subject === "fields") {
        add(
          each(["dayOfYear", "weekdayOfMonth", "weekOfMonth", "sun", "quarter", "weekOfYear"], field =>
            new Intl.DisplayNames("en", { type: "dateTimeField" }).of(field),
          ),
        );
        add(
          each(["sunday", "weekday", "dayOfYear"], unit => new Intl.RelativeTimeFormat("en").format(1, unit as "day")),
        );
      } else {
        add(
          each(["SystemV/EST5EDT", "SystemV/HST10", "Etc/Unknown", "Factory", "EST5EDT", "ACT"], timeZone =>
            new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "long" }).format(0),
          ),
        );
      }
    },
  },

  "likely subtags": {
    subjects: inputs => {
      const tags = (inputs.likely as string).split(" ");
      return Array.from({ length: Math.ceil(tags.length / 500) }, (_, i) => String(i));
    },
    ask(subject, add, inputs) {
      const tags = (inputs.likely as string).split(" ").slice(Number(subject) * 500, (Number(subject) + 1) * 500);
      add(each(tags, tag => `${new Intl.Locale(tag).maximize()} ${new Intl.Locale(tag).minimize()}`));
    },
  },

  "time zone rules": {
    subjects: inputs => inputs.zones,
    ask(timeZone, add) {
      // ICU knows more names than JavaScript takes: its own old abbreviations, and those of Windows.
      const known = each(
        [timeZone],
        zone => new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone,
      );
      add(known);
      if (known[0] === "!") return;
      add(
        each(
          [timeZone.toLowerCase(), timeZone.toUpperCase()],
          spelling => new Intl.DateTimeFormat("en", { timeZone: spelling }).resolvedOptions().timeZone,
        ),
      );
      // Every change there has been, and those of some years under the rule that goes on for ever.
      let z: Temporal.ZonedDateTime | null = Temporal.Instant.fromEpochMilliseconds(-5e12).toZonedDateTimeISO(timeZone);
      const changes: string[] = [];
      for (let i = 0; i < 500 && (z = z.getTimeZoneTransition("next")); i++)
        changes.push(`${z.epochMilliseconds}${z.offset}`);
      add(changes.join());
      add(
        each([-5e12, -3e12, 0, 1e12, 4e12, 6e12], t =>
          new Intl.DateTimeFormat("en", {
            timeZone,
            timeZoneName: "longOffset",
            year: "numeric",
            hour: "numeric",
          }).format(t),
        ),
      );
    },
  },

  // Not what Intl takes: any name that ICU knows, its own old abbreviations among them. In a process of its own, whose zone it is.
  "the process's time zone": {
    subjects: inputs => Array.from({ length: Math.ceil(inputs.zones.length / 100) }, (_, i) => String(i)),
    ask(subject, add, inputs) {
      const script = `for (const zone of ${JSON.stringify(inputs.zones.slice(Number(subject) * 100, (Number(subject) + 1) * 100))}) {
        process.env.TZ = zone;
        console.log(zone, new Intl.DateTimeFormat().resolvedOptions().timeZone, ...[1705000000000, 1720000000000, 0, -1e12, 4102444800000].map(t => {
          const d = new Date(t);
          return d.toString() + "|" + d.getTimezoneOffset() + "|" + d.toLocaleString("en") + "|" + d.getHours();
        }));
      }`;
      const child = Bun.spawnSync([process.execPath, "-e", script], {
        env: { ...process.env, TZ: "UTC" },
        stderr: "pipe",
      });
      add(`${child.exitCode} ${child.stdout}`);
    },
  },

  "normalization": {
    subjects: () => [...blocks(), "conformance"],
    ask(subject, add, inputs) {
      for (const form of ["NFC", "NFD", "NFKC", "NFKD"]) {
        if (subject === "conformance") add(each(inputs.normalizationTest as string[], s => s.normalize(form)));
        // By itself, among marks, and put together again from its parts.
        else
          add(
            each(block(subject), s =>
              [s, "a" + s + "\u0323\u0301", s.normalize("NFD"), s.normalize("NFKD")].map(t => t.normalize(form)),
            ),
          );
      }
    },
  },

  "domain names": {
    subjects: () => [...blocks(), "conformance"],
    ask(subject, add, inputs) {
      const { domainToASCII, domainToUnicode } = require("node:url");
      if (subject === "conformance") {
        add(
          each(
            (inputs.idnaTest as string[]).filter(s => s.isWellFormed()),
            s => domainToASCII(s) + "," + domainToUnicode(s),
          ),
        );
      } else {
        // A mark that belongs below the ones that a letter has takes the letter apart.
        add(
          each(block(subject), s =>
            [`a${s}b`, s, s.normalize("NFD"), s.normalize("NFKD"), s + "\u0323\u0301"].map(t =>
              domainToASCII(`${t}.example`),
            ),
          ),
        );
      }
    },
  },

  // What node:readline and util.inspect go by asks ICU which characters are emoji.
  "string width": {
    subjects: () => [...blocks(), "sequences"],
    ask(subject, add, inputs) {
      const width = (s: string) => Bun.stringWidth(s, { perCodePoint: true } as any);
      if (subject === "sequences") add(each(inputs.emojiSequences as string[], s => width(s)));
      else add(each(block(subject), s => `${width(s)}${width(s + "\ufe0f")}${width(s + "\u{1f3fd}")}`));
    },
  },
};

/** What asks for the pattern that a locale has for a skeleton, if anything does. */
function optionsOf(skeleton: string): Intl.DateTimeFormatOptions | undefined {
  const o: Intl.DateTimeFormatOptions = {};
  const number = (length: number) => (length === 2 ? "2-digit" : "numeric");
  const width = (length: number) => (length < 4 ? "short" : length === 4 ? "long" : "narrow");
  for (const [{ length, 0: letter }] of skeleton.matchAll(/(.)\1*/g)) {
    if (letter === "G") o.era = width(length);
    else if ("yUr".includes(letter)) o.year = number(length);
    else if ("ML".includes(letter)) o.month = length < 3 ? number(length) : width(length);
    else if (letter === "d") o.day = number(length);
    else if ("Ec".includes(letter) && length < 6) o.weekday = width(length);
    else if ("hHKk".includes(letter))
      [o.hour, o.hourCycle] = [number(length), ({ h: "h12", H: "h23", K: "h11", k: "h24" } as const)[letter as "h"]];
    else if (letter === "m") o.minute = number(length);
    else if (letter === "s") o.second = number(length);
    else if (letter === "B") o.dayPeriod = width(length);
    else if (letter === "v") o.timeZoneName = length === 1 ? "shortGeneric" : "longGeneric";
    else if (letter === "z") o.timeZoneName = length < 4 ? "short" : "long";
    // Quarters, weeks, and a width of weekday that there are no options for.
    else if (letter !== "a") return undefined;
  }
  return o;
}

const n = "numeric";
/** What no locale has a pattern for: one field is appended to the others. */
const UNUSUAL: Intl.DateTimeFormatOptions[] = [
  { year: n, weekday: "long" },
  { year: n, day: n },
  { era: "short", month: "long" },
  { era: "short", day: n },
  { month: "long", weekday: "short" },
  { hour: n, second: n },
  { minute: n },
  { second: n },
  { year: n, hour: n },
  { day: n, hour: n, minute: n },
  { year: n, timeZoneName: "short" },
  { month: "long", day: n, hour: n, minute: n, timeZoneName: "short" },
  { hour: n, minute: n, second: n, fractionalSecondDigits: 3 },
  { hour: n, minute: n, hourCycle: "h11" },
  { hour: n, minute: n, hourCycle: "h24" },
];
const MORNING = Date.UTC(2023, 4, 10, 9, 13, 20);
/** Ranges whose ends differ first by a minute, an hour, the half or the part of the day, a day, a month, a year or an era, in any calendar. */
const RANGES = [
  ...[
    5 * 60000,
    2 * 3600000,
    6 * 3600000,
    11 * 3600000,
    2 * DAY,
    5 * DAY,
    9 * DAY,
    30 * DAY,
    45 * DAY,
    75 * DAY,
    110 * DAY,
    400 * DAY,
    800 * DAY,
  ].map(d => [MORNING, MORNING + d]),
  [MORNING - 6 * 3600000, MORNING],
  ...[Date.UTC(-100, 4, 10), Date.UTC(500, 4, 10), Date.UTC(1900, 4, 10), Date.UTC(2018, 4, 10)].map(start => [
    start,
    MORNING,
  ]),
];
