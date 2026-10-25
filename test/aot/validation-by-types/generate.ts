// Writes a TypeScript program that checks `JSON.parse<T>(text)` on generated types and generated values: samples that are a T,
// every single change of each sample, and values that have nothing to do with T. Each value is handed over as JSON text, and the
// program compares
//   `JSON.parse<T>(text)`
//   `JSON.parse<T>(text, reviver)` with a reviver that changes nothing
//   `validate<T>(value)` on what `JSON.parse(text)` gives, which it must leave as it is
//   `JSON.parse(text)`: what is accepted is the same value with the same order of keys, and what is no JSON gets the same error
//   the same type written as a zod schema, if asked for
// in what they accept and refuse, in what they return, and in the issues. The text comes in many spellings that must make no
// difference: as `JSON.stringify()` writes it, indented, with the first character of each key or of each string escaped, as 16-bit
// text, as a rope, with white space in other places, with a member written twice, with whole numbers written as fractions and with
// exponents. Spellings that have an answer of their own (members in the opposite order, text that is no JSON) are asked twice, the
// second time with escaped keys. It prints one line per type (accepted, refused, a digest of every answer), a line for each
// disagreement, and a last line with the totals.
//
// An executable built with `--aot` runs code that the compiler has made for each T; `bun run --aot` walks a description of T. The
// digests make both-modes.test.ts a comparison of the two.
//
//   bun test/aot/validation-by-types/generate.ts <seed> <number of types> [zod]
//
// programs/data-from-outside/validation-compiled-and-interpreted-agree.ts is `generate.ts 7 36`.

type Generated = { type: string; zod: string; sample: () => unknown };

export function program(seed: number, count: number, withZod: boolean): string {
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));
  const choice = <T>(from: readonly T[]): T => from[Math.floor(random() * from.length)];
  const some = <T>(from: readonly T[], howMany: number): T[] => {
    const left = [...from];
    const taken: T[] = [];
    while (taken.length < howMany && left.length) taken.push(left.splice(Math.floor(random() * left.length), 1)[0]);
    return taken;
  };
  const names = ["id", "name", "kind", "items", "count", "flag", "note", "tags", "inner", "value", "left", "right", "with-dash", "size"];
  const key = (name: string): string => (/^[A-Za-z_]\w*$/.test(name) ? name : JSON.stringify(name));
  const constant = (value: unknown): Generated => ({ type: JSON.stringify(value), zod: `z.literal(${JSON.stringify(value)})`, sample: () => value });

  function text(): Generated {
    const tags: string[] = [];
    let zod = "z.string()", low = 0, high = 12, alphabet = "abcXYZ 09-";
    if (random() < 0.4) { low = between(1, 4); tags.push(`Schema.MinLength<${low}>`); zod += `.min(${low})`; }
    if (random() < 0.4) { high = between(low + 1, low + 6); tags.push(`Schema.MaxLength<${high}>`); zod += `.max(${high})`; }
    if (random() < 0.25) { alphabet = "abcdefgh"; tags.push('Schema.Pattern<"^[a-z]*$">'); zod += ".regex(/^[a-z]*$/)"; }
    return { type: ["string", ...tags].join(" & "), zod, sample: () => Array.from({ length: between(low, high) }, () => choice([...alphabet])).join("") };
  }

  function number(): Generated {
    const tags: string[] = [];
    let zod = "z.number()", low = -50, high = 50, whole = false, step = 1;
    if (random() < 0.5) { whole = true; tags.push("Schema.Int"); zod += ".int()"; }
    if (random() < 0.4) { low = between(-5, 5); tags.push(`Schema.Min<${low}>`); zod += `.min(${low})`; }
    if (random() < 0.4) { high = between(low + 10, low + 100); tags.push(`Schema.Max<${high}>`); zod += `.max(${high})`; }
    if (whole && random() < 0.25) { step = choice([2, 5]); tags.push(`Schema.MultipleOf<${step}>`); zod += `.multipleOf(${step})`; }
    const sample = (): number => {
      if (!whole) return choice([low, high, Math.round((low + random() * (high - low)) * 100) / 100]);
      const n = between(low, high);
      const stepped = n - (((n % step) + step) % step);
      return stepped >= low ? stepped : stepped + step;
    };
    return { type: ["number", ...tags].join(" & "), zod, sample };
  }

  function leaf(): Generated {
    const k = random();
    if (k < 0.35) return text();
    if (k < 0.7) return number();
    if (k < 0.8) return { type: "boolean", zod: "z.boolean()", sample: () => random() < 0.5 };
    if (k < 0.87) return { type: "null", zod: "z.null()", sample: () => null };
    return constant(choice(["a", "bee", "", 0, 1, 42, -3, true, false]));
  }

  function object(depth: number, discriminant?: string): Generated {
    const members: [string, boolean, Generated][] = [];
    let chosen = some(names, random() < 0.1 ? between(7, 10) : between(1, 5));
    if (discriminant !== undefined) {
      chosen = chosen.filter(name => name !== "kind");
      members.push(["kind", false, constant(discriminant)]);
    }
    for (const name of chosen) members.push([name, random() < 0.3, generate(depth - 1)]);
    const mode = discriminant !== undefined ? "plain" : choice(["plain", "plain", "strict", "indexed"]);
    const written = members.map(([name, optional, member]) => `${key(name)}${optional ? "?" : ""}: ${member.type};`).join(" ");
    const inner = "{ " + members.map(([name, optional, member]) => `${key(name)}: ${member.zod}${optional ? ".optional()" : ""}`).join(", ") + " }";
    const sample = (): unknown => {
      const made: Record<string, unknown> = {};
      for (const [name, optional, member] of members) if (!optional || random() < 0.6) made[name] = member.sample();
      if (mode !== "strict" && random() < 0.4) made.unknownKey = choice([1, "u", null, [1]]);
      return made;
    };
    if (mode === "indexed") return { type: `{ ${written} [key: string]: unknown; }`, zod: `z.looseObject(${inner})`, sample };
    if (mode === "strict") return { type: `({ ${written} } & Schema.Strict)`, zod: `z.strictObject(${inner})`, sample };
    return { type: `{ ${written} }`, zod: `z.looseObject(${inner})`, sample };
  }

  function list(element: Generated, mayBeTagged: boolean): Generated {
    const tags: string[] = [];
    let zod = `z.array(${element.zod})`, low = 0, high = 3;
    if (mayBeTagged && random() < 0.3) { low = between(1, 2); tags.push(`Schema.MinItems<${low}>`); zod += `.min(${low})`; }
    if (mayBeTagged && random() < 0.3) { high = between(low + 1, low + 3); tags.push(`Schema.MaxItems<${high}>`); zod += `.max(${high})`; }
    return { type: [`(${element.type})[]`, ...tags].join(" & "), zod, sample: () => Array.from({ length: between(low, high) }, () => element.sample()) };
  }

  function union(arms: Generated[]): Generated {
    return { type: "(" + arms.map(arm => arm.type).join(" | ") + ")", zod: "z.union([" + arms.map(arm => arm.zod).join(", ") + "])", sample: () => choice(arms).sample() };
  }

  function generate(depth: number): Generated {
    if (depth <= 0) return leaf();
    const k = random();
    if (k < 0.3) return leaf();
    if (k < 0.55) return object(depth);
    if (k < 0.7) return list(generate(depth - 1), true);
    if (k < 0.78) {
      const elements = Array.from({ length: between(1, 3) }, () => generate(depth - 1));
      return { type: "[" + elements.map(element => element.type).join(", ") + "]", zod: "z.tuple([" + elements.map(element => element.zod).join(", ") + "])", sample: () => elements.map(element => element.sample()) };
    }
    if (k < 0.86) {
      const held = generate(depth - 1);
      return { type: `Record<string, ${held.type}>`, zod: `z.record(z.string(), ${held.zod})`, sample: () => Object.fromEntries(Array.from({ length: between(0, 3) }, () => [choice(["a", "b", "c", "0", "k-1"]), held.sample()])) };
    }
    if (k < 0.93) return union(some(["circle", "square", "none", "line"], between(2, 3)).map(kind => object(depth - 1, kind)));
    return union(some([text(), number(), { type: "boolean", zod: "z.boolean()", sample: () => true }, { type: "null", zod: "z.null()", sample: () => null }, list(leaf(), false)], between(2, 4)));
  }

  const lines = [
    "// Generated by test/aot/validation-by-types/generate.ts " + seed + " " + count + (withZod ? " zod" : "") + ": JSON.parse<T>() gives one answer however the text is spelled, with a reviver or without, and validate<T>() gives the same; what it accepts is what JSON.parse() gives; and an executable answers as bun run --aot does.",
    'import type { Schema } from "bun";',
    'import { validate } from "bun:bundle";',
  ];
  if (withZod) lines.push('import * as z from "zod";');
  const cases: string[] = [];
  const one = (name: string, zod: string, samples: unknown[]): string =>
    `  ["${name}", (t: string) => Bun.JSON.parse<${name}>(t), (t: string) => Bun.JSON.parse<${name}>(t, (_, value) => value), (v: unknown) => validate<${name}>(v), ${zod}, ${JSON.stringify(samples)}],`;
  for (let i = 0; i < count; i++) {
    const generated = i % 3 ? object(3) : generate(3);
    lines.push(`type T${i} = ${generated.type};`);
    cases.push(one("T" + i, withZod ? generated.zod : "null", [generated.sample(), generated.sample(), generated.sample()]));
  }
  lines.push("interface Tree { value: number & Schema.Int; children: Tree[]; parent?: Tree | null }");
  lines.push("type Json = string | number | boolean | null | Json[] | { [key: string]: Json };");
  cases.push(one("Tree", "null", [{ value: 1, children: [{ value: 2, children: [], parent: null }, { value: 3, children: [{ value: 4, children: [] }] }] }]));
  cases.push(one("Json", "null", [{ a: [1, "two", [null, { b: true }]], c: {} }]));
  lines.push("const cases: [string, (t: string) => any, (t: string) => any, (v: unknown) => any, any, any[]][] = [", ...cases, "];");
  return lines.join("\n") + "\n" + comparison;
}

const comparison = String.raw`const junk = (): any[] => [null, true, false, 0, -1, 1, 2, 5, 1.5, 1e9, "", "a", "x", "ABC", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz", [], {}, [1], ["a"], { a: 1 }, { kind: "circle" }, [[]], [null]];
function show(value: any): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  return "{" + Object.keys(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}";
}
const sorted = (value: any): string => JSON.stringify(value, (_, inner) => (typeof inner === "object" && inner !== null && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1))) : inner));
const copy = (value: any): any => JSON.parse(JSON.stringify(value));
function paths(value: any, at: (string | number)[], found: (string | number)[][]): void {
  found.push(at);
  if (Array.isArray(value)) value.forEach((item, index) => paths(item, [...at, index], found));
  else if (typeof value === "object" && value !== null) for (const key of Object.keys(value)) paths(value[key], [...at, key], found);
}
function* mutations(sample: any): Generator<any> {
  yield copy(sample);
  const found: (string | number)[][] = [];
  paths(sample, [], found);
  for (const path of found) {
    const holder = (root: any): any => path.slice(0, -1).reduce((inner: any, key) => inner[key], root);
    const last = path[path.length - 1];
    for (const other of junk()) {
      if (path.length === 0) { yield other; continue; }
      const root = copy(sample); holder(root)[last] = other; yield root;
    }
    if (path.length > 0) {
      const root = copy(sample); const inner = holder(root);
      if (Array.isArray(inner)) inner.splice(last as number, 1); else delete inner[last];
      yield root;
    }
    const root = copy(sample); const here = path.reduce((inner: any, key) => inner[key], root);
    if (Array.isArray(here)) { here.push(here.length ? copy(here[0]) : 0); yield root; const more = copy(root); const there = path.reduce((inner: any, key) => inner[key], more); for (let i = 0; i < 6; i++) there.push(copy(there[0])); yield more; }
    else if (typeof here === "object" && here !== null) { here.extra = 1; yield root; }
    else if (typeof here === "string" && path.length > 0) { holder(root)[last] = here + "z"; yield root; const less = copy(sample); holder(less)[last] = here.slice(1); yield less; }
    else if (typeof here === "number" && path.length > 0) { for (const by of [1, -1, 0.5, 100, -100]) { const next = copy(sample); holder(next)[last] = here + by; yield next; } }
  }
}
let digestOfAll = 0, disagreements = 0, pathsThatDiffer = 0, ordersThatDiffer = 0;
function withEscapedKeys(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') { out += text[i]; continue; }
    let end = i + 1;
    while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
    const isKey = text[end + 1] === ":" && end > i + 1 && text[i + 1] !== "\\";
    out += isKey ? '"\\u' + text.charCodeAt(i + 1).toString(16).padStart(4, "0") + text.slice(i + 2, end + 1) : text.slice(i, end + 1);
    i = end;
  }
  return out;
}
type Spelling = { comma?: string; colon?: string; isTurned?: boolean; isDoubled?: boolean; escapesText?: boolean; number?: string; isPadded?: boolean; broken?: string };
const sameAnswer: Spelling[] = [{ comma: ", ", colon: ": " }, { comma: " ,", colon: " :" }, { isDoubled: true }, { escapesText: true }, { number: ".0" }, { number: "e0" }, { number: "E+00" }, { number: ".00e-0" }, { isPadded: true }];
const judgedAgainstEscapedKeys: Spelling[] = [{ isTurned: true }, { isTurned: true, comma: ",\n", colon: ": " }, { broken: "," }, { broken: "0" }, { broken: "\u0000" }, { broken: "}" }];
function spell(value: any, how: Spelling): string {
  const comma = how.comma ?? ",";
  if (typeof value === "string") return how.escapesText && value.length ? '"\\u' + value.charCodeAt(0).toString(16).padStart(4, "0") + JSON.stringify(value.slice(1)).slice(1) : JSON.stringify(value);
  if (typeof value === "number") return how.number !== undefined && /^-?\d+$/.test(String(value)) ? value + how.number : JSON.stringify(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(item => spell(item, how)).join(comma) + (how.broken ?? "") + "]";
  const members = Object.keys(value).map(key => JSON.stringify(key) + (how.colon ?? ":") + spell(value[key], how));
  if (how.isTurned) members.reverse();
  if (how.isDoubled && members.length) members.unshift(JSON.stringify(Object.keys(value)[0]) + ':[{"a":"\\n"},-1.5e3,null]');
  if (how.isPadded && members.length) members[0] = members[0] + " ".repeat(3);
  return "{" + members.join(comma) + (how.broken ?? "") + "}";
}
function attempt(parse: (given: any) => any, given: unknown): string {
  try {
    return "parsed " + show(parse(given));
  } catch (error: any) {
    return "threw " + error.constructor.name + " " + (error.issues === undefined ? JSON.stringify(error.message) : show(error.issues));
  }
}
function differ(what: string, name: string, text: string, left: string, right: string): void {
  if (disagreements++ < 20) console.log(what, name, text.slice(0, 200), "|", left.slice(0, 200), "|", right.slice(0, 200));
}
function compareWithUntyped(name: string, text: string, answer: string): void {
  const untyped = attempt(JSON.parse, text);
  if (answer.startsWith("threw TypeError [") ? !untyped.startsWith("parsed ") : answer !== untyped) differ("NOT WHAT JSON.parse(text) GIVES", name, text, answer, untyped);
}
for (const [name, parse, revive, validate, said, samples] of cases) {
  let accepted = 0, refused = 0, digest = 0;
  for (const sample of samples) {
    for (const value of mutations(sample)) {
      const text = JSON.stringify(value);
      const direct = attempt(parse, text);
      const isAccepted = direct.startsWith("parsed ");
      compareWithUntyped(name, text, direct);
      const revived = attempt(revive, text);
      if (revived !== direct) differ("A REVIVER MAKES A DIFFERENCE", name, text, direct, revived);
      const validated = attempt(validate, value);
      if (validated !== direct) differ("validate<T>() DISAGREES", name, text, direct, validated);
      if (JSON.stringify(value) !== text) differ("validate<T>() HAS CHANGED ITS ARGUMENT", name, text, direct, JSON.stringify(value));
      if (said !== null) {
        const theirs = said.safeParse(value);
        if (theirs.success !== isAccepted) differ("ZOD DISAGREES", name, text, direct, theirs.success ? "accepted" : JSON.stringify(theirs.error.issues));
        else if (isAccepted && sorted(theirs.data) !== sorted(value)) differ("ZOD's DATA DIFFERS", name, text, direct, JSON.stringify(theirs.data));
        else if (isAccepted && JSON.stringify(theirs.data) !== text) ordersThatDiffer++;
        else if (!isAccepted) {
          let issues: any[] = [];
          try { parse(text); } catch (error: any) { issues = error.issues; }
          const pathsOf = (list: any[]): string => [...new Set(list.map((issue: any) => issue.path.join("/")))].sort().join();
          if (pathsOf(issues) !== pathsOf(theirs.error.issues)) pathsThatDiffer++;
        }
      }
      for (const other of [JSON.stringify(value, null, 2), withEscapedKeys(text), (text + "\u0100").slice(0, -1), text.slice(0, text.length >> 1) + text.slice(text.length >> 1), " \t\r\n" + text + "\n ", ...sameAnswer.map(how => spell(value, how))]) {
        const answer = attempt(parse, other);
        if (answer !== direct) differ("A SPELLING MAKES A DIFFERENCE", name, other, direct, answer);
      }
      for (const how of judgedAgainstEscapedKeys) {
        const other = spell(value, how);
        const [answer, byEscapedKeys] = [attempt(parse, other), attempt(parse, withEscapedKeys(other))];
        if (answer !== byEscapedKeys) differ("ESCAPED KEYS MAKE A DIFFERENCE", name, other, byEscapedKeys, answer);
        compareWithUntyped(name, other, answer);
        for (let i = 0; i < answer.length; i++) digest = (digest * 31 + answer.charCodeAt(i)) | 0;
      }
      for (let i = 0; i < direct.length; i++) digest = (digest * 31 + direct.charCodeAt(i)) | 0;
      if (isAccepted) accepted++; else refused++;
    }
  }
  digestOfAll = (digestOfAll * 31 + digest) | 0;
  console.log(name, accepted, refused, digest);
}
console.log("all", digestOfAll, "disagreements", disagreements, "sets of paths that differ from zod's", pathsThatDiffer, "orders of keys that differ from zod's", ordersThatDiffer);
`;

if (import.meta.main) process.stdout.write(program(Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === "zod"));
