// Seeded differential fuzz of Bun.JSONC.parse against JSON.parse; replay a
// failure with BUN_JSON_FUZZ_SEED=<seed> (and BUN_JSON_FUZZ_ITERS for a soak).
import { expect, test } from "bun:test";

const DEFAULT_SEED = 0x6a736f6e;
const SEED = process.env.BUN_JSON_FUZZ_SEED !== undefined ? Number(process.env.BUN_JSON_FUZZ_SEED) >>> 0 : DEFAULT_SEED;

function envIters(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw) | 0;
  return n > 0 ? n : fallback;
}

const DOC_ITERS = envIters("BUN_JSON_FUZZ_ITERS", 400);
const MUTATION_ITERS = envIters("BUN_JSON_FUZZ_ITERS", 1500);

class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

const PLAIN_STRING_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-./:'<>!@#$%^&*()=~|;?";
const STRING_ESCAPES = ["\\n", "\\t", "\\r", "\\b", "\\f", "\\\\", '\\"', "\\/", "\\u0000", "\\u001f", "\\uffff"];
const RAW_NON_ASCII = ["é", "ß", "ÿ", "日", "中文", "Ω≈ç√", "ࠀ", "🚀", "😀", "𝟘"];

function hex4(n: number): string {
  return n.toString(16).padStart(4, "0");
}

function genStringToken(rng: Rng): string {
  let body = "";
  const chunks = rng.int(7);
  for (let i = 0; i < chunks; i++) {
    switch (rng.int(8)) {
      case 0:
      case 1:
      case 2: {
        const n = rng.range(1, 6);
        for (let j = 0; j < n; j++) body += PLAIN_STRING_CHARS[rng.int(PLAIN_STRING_CHARS.length)];
        break;
      }
      case 3:
        body += rng.pick(STRING_ESCAPES);
        break;
      case 4:
        body += "\\u" + hex4(rng.int(0x10000));
        break;
      case 5:
        body += rng.pick(["\\uD800", "\\udfff", "\\uDBFF", "\\uDC00", "\\uD83D\\uDE00"]);
        break;
      case 6:
        body += rng.pick(RAW_NON_ASCII);
        break;
      case 7:
        body += rng.pick(["", "__proto__", "constructor", "0", "1e3", "true", "null", "//", "/*", "*/"]);
        break;
    }
  }
  return '"' + body + '"';
}

function genNumberToken(rng: Rng): string {
  switch (rng.int(8)) {
    case 0:
      return String(rng.range(-1000, 1000));
    case 1:
      return rng.pick(["0", "-0", "0.0", "-0.0", "0e0", "-0e-0", "0E+0", "-0.000e2"]);
    case 2:
      return rng.pick([
        "-9007199254740993",
        "9007199254740993",
        "9007199254740992",
        "-9007199254740991",
        "123456789012345678901234567890",
        "-123456789012345678901234567890",
      ]);
    case 3: {
      let s = String(rng.range(1, 9));
      s += ".";
      for (let i = 0; i < 16; i++) s += String(rng.int(10));
      return (rng.chance(0.5) ? "-" : "") + s;
    }
    case 4: {
      let s = String(rng.range(1, 9));
      const frac = rng.int(18);
      if (frac > 0) {
        s += ".";
        for (let i = 0; i < frac; i++) s += String(rng.int(10));
      }
      const e = rng.pick(["e", "E"]);
      const sign = rng.pick(["", "+", "-"]);
      s += e + sign + String(rng.int(330));
      return (rng.chance(0.5) ? "-" : "") + s;
    }
    case 5:
      return rng.pick([
        "1e400",
        "-1e400",
        "5e-324",
        "4.9e-324",
        "2.4703282292062327e-324",
        "1.7976931348623157e308",
        "1.7976931348623159e308",
      ]);
    case 6: {
      let s = "0.";
      const n = rng.range(1, 32);
      for (let i = 0; i < n; i++) s += String(rng.int(10));
      return (rng.chance(0.5) ? "-" : "") + s;
    }
    default:
      return rng.pick(["1e5", "1E5", "1e+5", "1e-5", "12E-2", "100000", "-1", "2", "10.5"]);
  }
}

function genKeyToken(rng: Rng): string {
  if (rng.chance(0.08)) return '"__proto__"';
  if (rng.chance(0.05)) return '"\\u005f_proto__"';
  return genStringToken(rng);
}

function genValueTokens(rng: Rng, out: string[], depth: number, budget: { n: number }): void {
  budget.n--;
  const allowContainer = depth > 0 && budget.n > 0;
  const kind = allowContainer ? rng.int(10) : 4 + rng.int(6);
  if (kind <= 1) {
    out.push("{");
    const n = rng.int(6);
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) out.push(",");
      const key = keys.length > 0 && rng.chance(0.15) ? rng.pick(keys) : genKeyToken(rng);
      keys.push(key);
      out.push(key, ":");
      genValueTokens(rng, out, depth - 1, budget);
    }
    out.push("}");
  } else if (kind <= 3) {
    out.push("[");
    const n = rng.int(6);
    for (let i = 0; i < n; i++) {
      if (i > 0) out.push(",");
      genValueTokens(rng, out, depth - 1, budget);
    }
    out.push("]");
  } else if (kind <= 6) {
    out.push(genStringToken(rng));
  } else if (kind <= 8) {
    out.push(genNumberToken(rng));
  } else {
    out.push(rng.pick(["true", "false", "null"]));
  }
}

function genDocTokens(rng: Rng): string[] {
  const out: string[] = [];
  genValueTokens(rng, out, rng.range(1, 4), { n: 200 });
  return out;
}

const WHITESPACE = [" ", "  ", "\t", "\n", "\r", "\r\n", "\n\t ", " \n"];

function genWs(rng: Rng): string {
  return rng.chance(0.35) ? rng.pick(WHITESPACE) : "";
}

function joinTokens(tokens: string[], rng: Rng): string {
  let s = genWs(rng);
  for (const tok of tokens) s += tok + genWs(rng);
  return s;
}

const COMMENT_FILLER = [..."abc XYZ 09 *,:[]{}\"'\\ é true null e+10 -", "🚀", "日本"];

function genComment(rng: Rng, atEof: boolean): string {
  if (rng.chance(0.5)) {
    let body = "";
    const n = rng.int(12);
    for (let i = 0; i < n; i++) body += rng.chance(0.15) ? "\n" : rng.pick(COMMENT_FILLER);
    return "/*" + body.replaceAll("*/", "* /") + "*/";
  }
  let body = "";
  const n = rng.int(12);
  for (let i = 0; i < n; i++) body += rng.pick(COMMENT_FILLER);
  return "//" + body + (atEof && rng.chance(0.5) ? "" : "\n");
}

function toSingleQuoted(token: string): string {
  return "'" + token.slice(1, -1) + "'";
}

function decorate(tokens: string[], rng: Rng): string {
  let s = "";
  const gap = (atEof: boolean) => {
    const c1 = rng.chance(0.25);
    const ws = rng.chance(0.4);
    const c2 = rng.chance(0.1);
    let g = "";
    if (c1) g += genComment(rng, atEof && !ws && !c2);
    if (ws) g += rng.pick(WHITESPACE);
    if (c2) g += genComment(rng, atEof);
    return g;
  };
  s += gap(false);
  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : "";
    if ((tok === "}" || tok === "]") && i > 0 && prev !== "{" && prev !== "[" && rng.chance(0.4)) {
      s += "," + gap(false);
    }
    const wantSingle = rng.chance(0.2);
    if (wantSingle && tok.length >= 2 && tok[0] === '"' && !tok.includes("'")) {
      tok = toSingleQuoted(tok);
    }
    s += tok;
    s += gap(i === tokens.length - 1);
  }
  return s;
}

const MUTATION_ALPHABET = `{}[]",:0123456789eE.+-\\/ \n\r\ttruefalsnu'`;

function randChar(rng: Rng): string {
  return rng.chance(0.25) ? String.fromCharCode(rng.int(256)) : MUTATION_ALPHABET[rng.int(MUTATION_ALPHABET.length)];
}

function mutate(text: string, rng: Rng): string {
  let s = text;
  const ops = rng.range(1, 3);
  for (let k = 0; k < ops; k++) {
    if (s.length === 0) {
      s = randChar(rng);
      continue;
    }
    const pos = rng.int(s.length);
    switch (rng.int(3)) {
      case 0:
        s = s.slice(0, pos) + s.slice(pos + 1);
        break;
      case 1:
        s = s.slice(0, pos) + randChar(rng) + s.slice(pos);
        break;
      default:
        s = s.slice(0, pos) + randChar(rng) + s.slice(pos + 1);
        break;
    }
  }
  return s.isWellFormed() ? s : s.toWellFormed();
}

function show(v: unknown): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (v === undefined) return "undefined";
  try {
    return String(JSON.stringify(v));
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function deepCompare(jsc: unknown, bun: unknown, path: string): string | null {
  if (Object.is(jsc, bun)) return null;
  if (jsc === null || bun === null || typeof jsc !== "object" || typeof bun !== "object" || typeof jsc !== typeof bun) {
    if (typeof jsc === "string" && typeof bun === "string") {
      let at = 0;
      const n = Math.min(jsc.length, bun.length);
      while (at < n && jsc.charCodeAt(at) === bun.charCodeAt(at)) at++;
      return (
        `${path}: strings differ at code unit ${at} ` +
        `(lengths ${jsc.length} vs ${bun.length}; ` +
        `0x${(jsc.charCodeAt(at) || 0).toString(16)} vs 0x${(bun.charCodeAt(at) || 0).toString(16)}): ` +
        `JSON.parse => ${show(jsc)}, Bun.JSONC.parse => ${show(bun)}`
      );
    }
    return `${path}: JSON.parse => ${show(jsc)} (${typeof jsc}) but Bun.JSONC.parse => ${show(bun)} (${typeof bun})`;
  }
  const jscIsArray = Array.isArray(jsc);
  const bunIsArray = Array.isArray(bun);
  if (jscIsArray !== bunIsArray) {
    return `${path}: JSON.parse produced ${jscIsArray ? "an array" : "an object"} but Bun.JSONC.parse produced ${bunIsArray ? "an array" : "an object"}`;
  }
  if (jscIsArray) {
    const a = jsc as unknown[];
    const b = bun as unknown[];
    if (a.length !== b.length) return `${path}: array length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const r = deepCompare(a[i], b[i], `${path}[${i}]`);
      if (r !== null) return r;
    }
    return null;
  }
  const jscKeys = Object.keys(jsc);
  const bunKeys = Object.keys(bun);
  if (jscKeys.length !== bunKeys.length || jscKeys.some((k, i) => k !== bunKeys[i])) {
    return `${path}: own key order differs: JSON.parse => ${JSON.stringify(jscKeys)} but Bun.JSONC.parse => ${JSON.stringify(bunKeys)}`;
  }
  for (const key of jscKeys) {
    const dj = Object.getOwnPropertyDescriptor(jsc, key);
    const db = Object.getOwnPropertyDescriptor(bun, key);
    if (!db || !("value" in db))
      return `${path}[${JSON.stringify(key)}]: missing own data property on the Bun.JSONC.parse side`;
    const r = deepCompare(dj!.value, db.value, `${path}[${JSON.stringify(key)}]`);
    if (r !== null) return r;
  }
  return null;
}

function reproInfo(iteration: number, text: string): string {
  return `seed=${SEED} iteration=${iteration} input=${JSON.stringify(text)}`;
}

test(`differential fuzz: generated JSON and JSONC decorations agree with JSON.parse (seed=${SEED}, iters=${DOC_ITERS})`, () => {
  const rng = new Rng(SEED);
  let maxTokens = 0;
  for (let i = 0; i < DOC_ITERS; i++) {
    const tokens = genDocTokens(rng);
    if (tokens.length > maxTokens) maxTokens = tokens.length;
    const text = joinTokens(tokens, rng);

    let jsc: unknown;
    try {
      jsc = JSON.parse(text);
    } catch (e) {
      throw new Error(`generator emitted text JSON.parse rejects (${e}). ${reproInfo(i, text)}`);
    }

    let bun: unknown;
    try {
      bun = Bun.JSONC.parse(text);
    } catch (e) {
      throw new Error(`Bun.JSONC.parse threw on valid JSON: ${e}. ${reproInfo(i, text)}`);
    }
    const diff = deepCompare(jsc, bun, "$");
    if (diff !== null) {
      throw new Error(`Bun.JSONC.parse disagrees with JSON.parse: ${diff}. ${reproInfo(i, text)}`);
    }

    const decorated = decorate(tokens, rng);
    let bunDecorated: unknown;
    try {
      bunDecorated = Bun.JSONC.parse(decorated);
    } catch (e) {
      throw new Error(
        `Bun.JSONC.parse threw on a JSONC-decorated form of valid JSON: ${e}. ` +
          `${reproInfo(i, decorated)} (undecorated original=${JSON.stringify(text)})`,
      );
    }
    const diffDecorated = deepCompare(jsc, bunDecorated, "$");
    if (diffDecorated !== null) {
      throw new Error(
        `Bun.JSONC.parse(decorated) disagrees with JSON.parse(original): ${diffDecorated}. ` +
          `${reproInfo(i, decorated)} (undecorated original=${JSON.stringify(text)})`,
      );
    }
  }
  console.log(`json-differential-fuzz: ${DOC_ITERS} generated docs OK (seed=${SEED}, largest doc=${maxTokens} tokens)`);
  expect(maxTokens).toBeGreaterThan(1);
});

test(`differential fuzz: mutated documents (seed=${SEED}, iters=${MUTATION_ITERS})`, () => {
  const rng = new Rng((SEED ^ 0x9e3779b9) >>> 0);
  let base = "";
  let jscAccepted = 0;
  let bunAccepted = 0;
  let bothAccepted = 0;
  for (let i = 0; i < MUTATION_ITERS; i++) {
    if (i % 4 === 0) base = joinTokens(genDocTokens(rng), rng);
    const text = mutate(base, rng);

    let jsc: unknown;
    let jscOk = true;
    try {
      jsc = JSON.parse(text);
    } catch {
      jscOk = false;
    }

    let bun: unknown;
    let bunOk = true;
    let bunErr: unknown = null;
    try {
      bun = Bun.JSONC.parse(text);
    } catch (e) {
      bunOk = false;
      bunErr = e;
    }

    if (jscOk) jscAccepted++;
    if (bunOk) bunAccepted++;
    if (jscOk && bunOk) bothAccepted++;

    if (jscOk) {
      if (!bunOk) {
        throw new Error(
          `mutant accepted by JSON.parse but rejected by Bun.JSONC.parse (${bunErr}). ${reproInfo(i, text)}`,
        );
      }
      const diff = deepCompare(jsc, bun, "$");
      if (diff !== null) {
        throw new Error(`mutant parsed differently: ${diff}. ${reproInfo(i, text)}`);
      }
    } else if (bunOk) {
      try {
        JSON.stringify(bun);
      } catch (e) {
        throw new Error(
          `Bun.JSONC.parse accepted a mutant but produced a value JSON.stringify rejects: ${e}. ${reproInfo(i, text)}`,
        );
      }
    } else if (bunErr === null || bunErr === undefined) {
      throw new Error(`Bun.JSONC.parse threw ${show(bunErr)} on a mutant. ${reproInfo(i, text)}`);
    }
  }
  console.log(
    `json-differential-fuzz: ${MUTATION_ITERS} mutants (seed=${SEED}): ` +
      `JSON.parse accepted ${jscAccepted}, Bun.JSONC.parse accepted ${bunAccepted}, both accepted ${bothAccepted}`,
  );
  expect(jscAccepted).toBeGreaterThan(0);
  expect(jscAccepted).toBeLessThan(MUTATION_ITERS);
  expect(bunAccepted).toBeGreaterThanOrEqual(jscAccepted);
  expect(bothAccepted).toBe(jscAccepted);
});

test("__proto__ key becomes an own data property and never pollutes Object.prototype", () => {
  const text = '{"__proto__":{"polluted":1},"a":2}';
  const jsc = JSON.parse(text) as any;
  const bun = Bun.JSONC.parse(text) as any;
  expect(({} as any).polluted).toBeUndefined();
  expect(Object.getPrototypeOf(bun)).toBe(Object.prototype);
  expect(Object.keys(bun)).toEqual(["__proto__", "a"]);
  const desc = Object.getOwnPropertyDescriptor(bun, "__proto__");
  expect(desc).toBeDefined();
  expect(desc!.value).toEqual({ polluted: 1 });
  expect(deepCompare(jsc, bun, "$")).toBeNull();
});

test("lone surrogates from \\uXXXX escapes are preserved code-unit-for-code-unit", () => {
  const text = '["a\\uD800b", "\\uDC00", "\\uD83D\\uDE00", "\\uDBFF tail"]';
  const jsc = JSON.parse(text) as string[];
  const bun = Bun.JSONC.parse(text) as string[];
  expect(deepCompare(jsc, bun, "$")).toBeNull();
  expect(Array.from(bun[0], c => c.charCodeAt(0))).toEqual([0x61, 0xd800, 0x62]);
  expect(bun[2]).toBe("\u{1F600}");
});

test("-0 and 0 are distinguished exactly like JSON.parse", () => {
  for (const text of ["-0", "0", "[-0,0,-0.0,0e0,-0e-0]", '{"a":-0}']) {
    const jsc = JSON.parse(text);
    const bun = Bun.JSONC.parse(text);
    expect(deepCompare(jsc, bun, "$")).toBeNull();
  }
  expect(Object.is(Bun.JSONC.parse("-0"), -0)).toBe(true);
  expect(Object.is(Bun.JSONC.parse("0"), 0)).toBe(true);
});

test("duplicate keys keep first-insertion order with the last value, like JSON.parse", () => {
  const text = '{"a":1,"b":2,"a":3,"\\u0062":4}';
  const jsc = JSON.parse(text);
  const bun = Bun.JSONC.parse(text);
  expect(deepCompare(jsc, bun, "$")).toBeNull();
  expect(bun).toEqual({ a: 3, b: 4 });
  expect(Object.keys(bun as object)).toEqual(["a", "b"]);
});
