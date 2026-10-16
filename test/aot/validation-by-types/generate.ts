// Writes a TypeScript program that checks validation by a type on generated types and generated values: samples that are a T,
// every single change of each sample, and values that have nothing to do with T. For each value the program compares
//   `Bun.safeValidate<T>()`
//   the `validate` function of `Bun.schema<T>()`
//   the same type written as a zod schema, if asked for
// in what they accept and refuse, in the data they return with the order of its keys, and in the issues. It also hands the value as
// JSON text to `Bun.parse<T>()` in many spellings that must make no difference: as `JSON.stringify()` writes it, indented, with the
// first character of each key or of each string escaped, as 16-bit text, as a rope, with white space in other places, with a member
// written twice, with whole numbers written as fractions and with exponents. Spellings that have an answer of their own (members in
// the opposite order, text that is no JSON) are asked twice, the second time with escaped keys. It prints one line per type (accepted, refused, a digest of every answer), a line for
// each disagreement, and a last line with the totals.
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
    if (random() < 0.4) { low = between(1, 4); tags.push(`MinLength<${low}>`); zod += `.min(${low})`; }
    if (random() < 0.4) { high = between(low + 1, low + 6); tags.push(`MaxLength<${high}>`); zod += `.max(${high})`; }
    if (random() < 0.25) { alphabet = "abcdefgh"; tags.push('Pattern<"^[a-z]*$">'); zod += ".regex(/^[a-z]*$/)"; }
    return { type: ["string", ...tags].join(" & "), zod, sample: () => Array.from({ length: between(low, high) }, () => choice([...alphabet])).join("") };
  }

  function number(): Generated {
    const tags: string[] = [];
    let zod = "z.number()", low = -50, high = 50, whole = false, step = 1;
    if (random() < 0.5) { whole = true; tags.push("Int"); zod += ".int()"; }
    if (random() < 0.4) { low = between(-5, 5); tags.push(`Min<${low}>`); zod += `.min(${low})`; }
    if (random() < 0.4) { high = between(low + 10, low + 100); tags.push(`Max<${high}>`); zod += `.max(${high})`; }
    if (whole && random() < 0.25) { step = choice([2, 5]); tags.push(`MultipleOf<${step}>`); zod += `.multipleOf(${step})`; }
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
    let chosen = some(names, between(1, 5));
    if (discriminant !== undefined) {
      chosen = chosen.filter(name => name !== "kind");
      members.push(["kind", false, constant(discriminant)]);
    }
    for (const name of chosen) members.push([name, random() < 0.3, generate(depth - 1)]);
    const mode = discriminant !== undefined ? "strip" : choice(["strip", "strip", "strict", "keep"]);
    const written = members.map(([name, optional, member]) => `${key(name)}${optional ? "?" : ""}: ${member.type};`).join(" ");
    const inner = "{ " + members.map(([name, optional, member]) => `${key(name)}: ${member.zod}${optional ? ".optional()" : ""}`).join(", ") + " }";
    const sample = (): unknown => {
      const made: Record<string, unknown> = {};
      for (const [name, optional, member] of members) if (!optional || random() < 0.6) made[name] = member.sample();
      if (mode !== "strict" && random() < 0.4) made.unknownKey = choice([1, "u", null, [1]]);
      return made;
    };
    if (mode === "keep") return { type: `{ ${written} [key: string]: unknown; }`, zod: `z.looseObject(${inner})`, sample };
    if (mode === "strict") return { type: `({ ${written} } & Strict)`, zod: `z.strictObject(${inner})`, sample };
    return { type: `{ ${written} }`, zod: `z.object(${inner})`, sample };
  }

  function list(element: Generated, mayBeTagged: boolean): Generated {
    const tags: string[] = [];
    let zod = `z.array(${element.zod})`, low = 0, high = 3;
    if (mayBeTagged && random() < 0.3) { low = between(1, 2); tags.push(`MinItems<${low}>`); zod += `.min(${low})`; }
    if (mayBeTagged && random() < 0.3) { high = between(low + 1, low + 3); tags.push(`MaxItems<${high}>`); zod += `.max(${high})`; }
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
    "// Generated by test/aot/validation-by-types/generate.ts " + seed + " " + count + (withZod ? " zod" : "") + ": Bun.safeValidate<T>(), Bun.schema<T>() and Bun.parse<T>() give the same answers, and the same in an executable as under bun run --aot.",
    'import type { Int, Min, Max, MinLength, MaxLength, MinItems, MaxItems, Pattern, MultipleOf, Strict } from "bun";',
  ];
  if (withZod) lines.push('import * as z from "zod";');
  const cases: string[] = [];
  for (let i = 0; i < count; i++) {
    const generated = i % 3 ? object(3) : generate(3);
    lines.push(`type T${i} = ${generated.type};`);
    const samples = [generated.sample(), generated.sample(), generated.sample()];
    cases.push(`  ["T${i}", (v: unknown) => Bun.safeValidate<T${i}>(v), Bun.schema<T${i}>(), ${withZod ? generated.zod : "null"}, ${JSON.stringify(samples)}, (t: string) => Bun.parse<T${i}>(t)],`);
  }
  lines.push("interface Tree { value: number & Int; children: Tree[]; parent?: Tree | null }");
  lines.push("type Json = string | number | boolean | null | Json[] | { [key: string]: Json };");
  cases.push('  ["Tree", (v: unknown) => Bun.safeValidate<Tree>(v), Bun.schema<Tree>(), null, [{"value":1,"children":[{"value":2,"children":[],"parent":null},{"value":3,"children":[{"value":4,"children":[]}]}]}], (t: string) => Bun.parse<Tree>(t)],');
  cases.push('  ["Json", (v: unknown) => Bun.safeValidate<Json>(v), Bun.schema<Json>(), null, [{"a":[1,"two",[null,{"b":true}]],"c":{}}], (t: string) => Bun.parse<Json>(t)],');
  lines.push("const cases: [string, (v: unknown) => any, any, any, any[], (t: string) => any][] = [", ...cases, "];");
  return lines.join("\n") + "\n" + comparison;
}

const comparison = String.raw`const junk = (): any[] => [undefined, null, true, false, 0, -0, -1, 1, 2, 5, 1.5, 1e9, NaN, Infinity, "", "a", "x", "ABC", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz", [], {}, [1], ["a"], { a: 1 }, { kind: "circle" }, [[]], [null]];
function show(value: any): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
  return "{" + Object.keys(value).map(key => JSON.stringify(key) + ":" + show(value[key])).join(",") + "}";
}
const sorted = (value: any): string => JSON.stringify(value, (_, inner) => (typeof inner === "object" && inner !== null && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1))) : inner));
const copy = (value: any): any => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
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
const ownAnswer: Spelling[] = [{ isTurned: true }, { isTurned: true, comma: ",\n", colon: ": " }, { broken: "," }, { broken: "0" }, { broken: "\u0000" }, { broken: "}" }];
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
function attempt(parse: (t: string) => any, text: string): string {
  try {
    return "parsed " + show(parse(text));
  } catch (error: any) {
    return "threw " + error.constructor.name + " " + show(error.issues);
  }
}
for (const [name, compiled, schema, said, samples, parse] of cases) {
  let accepted = 0, refused = 0, digest = 0;
  for (const sample of samples) {
    for (const value of mutations(sample)) {
      const before = show(value);
      const a = compiled(value);
      const b = schema["~standard"].validate(value);
      const left = a.success ? "accepted " + show(a.data) : "refused " + show(a.issues);
      const right = b.issues === undefined ? "accepted " + show(b.value) : "refused " + show(b.issues);
      if (left !== right && disagreements++ < 20) console.log("DISAGREE", name, before, "|", left.slice(0, 200), "|", right.slice(0, 200));
      if (show(value) !== before && disagreements++ < 20) console.log("THE VALUE WAS CHANGED", name, before);
      if (said !== null) {
        const c = said.safeParse(value);
        if (c.success !== a.success) { if (disagreements++ < 40) console.log("ZOD DISAGREES", name, before, "|", left.slice(0, 160), "|", c.success ? "accepted" : JSON.stringify(c.error.issues).slice(0, 160)); }
        else if (c.success && sorted(c.data) !== sorted(a.data)) { if (disagreements++ < 40) console.log("ZOD's DATA DIFFERS", name, before, "|", JSON.stringify(a.data).slice(0, 160), "|", JSON.stringify(c.data).slice(0, 160)); }
        else if (c.success && JSON.stringify(c.data) !== JSON.stringify(a.data)) ordersThatDiffer++;
        else if (!c.success) {
          const ours = new Set(a.issues.map((issue: any) => issue.path.join("/"))), theirs = new Set(c.error.issues.map((issue: any) => issue.path.join("/")));
          if ([...ours].sort().join() !== [...theirs].sort().join()) pathsThatDiffer++;
        }
      }
      const text = JSON.stringify(value);
      if (text !== undefined) {
        const direct = attempt(parse, text);
        const plain = JSON.parse(text);
        for (const other of [JSON.stringify(value, null, 2), withEscapedKeys(text), (text + "\u0100").slice(0, -1), text.slice(0, text.length >> 1) + text.slice(text.length >> 1), " \t\r\n" + text + "\n ", ...sameAnswer.map(how => spell(plain, how))]) {
          const answer = attempt(parse, other);
          if (answer !== direct && disagreements++ < 20) console.log("Bun.parse DISAGREES WITH ITSELF", name, other.slice(0, 200), "|", direct.slice(0, 200), "|", answer.slice(0, 200));
        }
        for (const how of ownAnswer) {
          const other = spell(plain, how);
          const [answer, byEscapedKeys] = [attempt(parse, other), attempt(parse, withEscapedKeys(other))];
          if (answer !== byEscapedKeys && disagreements++ < 20) console.log("Bun.parse DISAGREES WITH ITSELF", name, other.slice(0, 200), "|", byEscapedKeys.slice(0, 200), "|", answer.slice(0, 200));
          for (let i = 0; i < answer.length; i++) digest = (digest * 31 + answer.charCodeAt(i)) | 0;
        }
        for (let i = 0; i < direct.length; i++) digest = (digest * 31 + direct.charCodeAt(i)) | 0;
      }
      if (a.success) accepted++; else refused++;
      for (let i = 0; i < left.length; i++) digest = (digest * 31 + left.charCodeAt(i)) | 0;
    }
  }
  digestOfAll = (digestOfAll * 31 + digest) | 0;
  console.log(name, accepted, refused, digest);
}
console.log("all", digestOfAll, "disagreements", disagreements, "sets of paths that differ from zod's", pathsThatDiffer, "orders of keys that differ from zod's", ordersThatDiffer);
`;

if (import.meta.main) process.stdout.write(program(Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === "zod"));
