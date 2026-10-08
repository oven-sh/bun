// Where exec.ts and ops.ts get patterns and text from.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

export type Case = [pattern: string, flags: string, text: string, lastIndex: number];

let seed = 1;
export function setSeed(value: number) {
  seed = value;
}

export function random(n: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
}
export const pick = <T>(list: readonly T[]): T => list[random(list.length)];

function* files(dir: string, extension: RegExp): Iterable<string> {
  if (statSync(dir).isFile()) return void (yield dir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isDirectory()) yield* files(join(dir, entry.name), extension);
    else if (extension.test(entry.name)) yield join(dir, entry.name);
  }
}

// == text that a pattern is likely to match, or almost ==

const ALPHABET = [..."abcABCxyz_$019 \t\n-./\\'\"`(){}[]<>*+?|^#@!%&=:;,~", "\r", "\u2028", "é", "É", "ß", "ſ", "K", "İ", "ı", "σ", "ς", "Σ", "ǆ", "ǅ", "Ǆ", "\u{1f4a9}", "\u{10400}", "\u{10428}", "\ud83d", "\udca9", "中", "\u00a0", "\ufeff"];

/** A string made by walking the source of the pattern: literal characters stay, the rest is guessed. */
function sample(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      const next = pattern[++i] ?? "";
      if (next === "d") out += pick([..."0159"]);
      else if (next === "w") out += pick([..."aZ_0"]);
      else if (next === "s") out += pick([" ", "\t", "\n", "\u00a0"]);
      else if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "u" && /^[0-9a-f]{4}/i.test(pattern.slice(i + 1))) {
        out += String.fromCharCode(parseInt(pattern.slice(i + 1, i + 5), 16));
        i += 4;
      } else if (/[bBDWSpPkcxu0-9]/.test(next)) out += pick(ALPHABET);
      else out += next;
    } else if (c === "[") {
      let end = i + 1;
      while (end < pattern.length && (pattern[end] !== "]" || end === i + 1)) end += pattern[end] === "\\" ? 2 : 1;
      const members = pattern.slice(i + 1, end).replace(/^\^/, "").replace(/\\/g, "");
      out += members.length && random(4) ? members[random(members.length)] : pick(ALPHABET);
      i = end;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end > 0 && /^\{\d+(,\d*)?\}/.test(pattern.slice(i))) {
        out += out.slice(-1).repeat(Math.min(parseInt(pattern.slice(i + 1)), 5));
        i = end;
      } else out += c;
    } else if (c === "*" || c === "+") out += out.slice(-1).repeat(random(3));
    else if (c === "|") {
      if (random(2)) out = "";
      else break;
    } else if (c === "(") {
      if (pattern[i + 1] === "?") i = Math.max(i + 1, pattern.slice(i).search(/[:=!>]/) + i);
    } else if (c === "." ) out += pick(ALPHABET);
    else if (!")?^$".includes(c)) out += c;
  }
  return out;
}

function mutate(text: string): string {
  const at = random(text.length + 1);
  switch (random(4)) {
    case 0:
      return text.slice(0, at) + pick(ALPHABET) + text.slice(at);
    case 1:
      return text.slice(0, at) + text.slice(at + 1);
    case 2:
      return pick(ALPHABET) + text + pick(ALPHABET);
    default:
      return random(2) ? text.toUpperCase() : text.toLowerCase();
  }
}

function* texts(pattern: string): Iterable<string> {
  yield "";
  for (let i = 0; i < 6; i++) {
    const text = sample(pattern);
    yield text;
    yield mutate(text);
    yield `${pick(ALPHABET)}${pick(ALPHABET)}${text}${text}`;
  }
}

// == sources ==

async function* literals(spec: string): AsyncIterable<Case> {
  const [module, dirs] = spec.split(":");
  const ts = (await import(module)).default;
  const found = new Map<string, [string, string]>();
  const lines: string[] = [];
  for (const dir of dirs.split(",")) {
    for (const file of files(dir, /\.[cm]?[jt]sx?$/)) {
      const text = readFileSync(file, "utf8");
      const all = text.split("\n");
      for (let i = 0; i < 3; i++) lines.push(pick(all));
      const visit = (node: any) => {
        if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
          const end = node.text.lastIndexOf("/");
          found.set(node.text, [node.text.slice(1, end), node.text.slice(end + 1)]);
        } else if (
          (node.kind === ts.SyntaxKind.NewExpression || node.kind === ts.SyntaxKind.CallExpression) &&
          node.expression.getText?.() === "RegExp" &&
          node.arguments?.length &&
          node.arguments.every((a: any) => ts.isStringLiteralLike(a))
        ) {
          found.set(node.getText(), [node.arguments[0].text, node.arguments[1]?.text ?? ""]);
        }
        ts.forEachChild(node, visit);
      };
      visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
    }
  }
  console.log(`${found.size} regular expressions`);
  for (const [pattern, flags] of found.values()) {
    for (const text of texts(pattern)) yield [pattern, flags, text, 0];
    for (let i = 0; i < 10; i++) yield [pattern, flags, pick(lines), 0];
  }
}

function* fixtures(dir: string): Iterable<Case> {
  const seen = new Set<string>();
  for (const file of files(dir, /\.json$/)) {
    const { cases = [], valid = [], invalid = [] } = JSON.parse(readFileSync(file, "utf8"));
    for (const test of [...cases, ...valid, ...invalid]) {
      if (!test?.options || typeof test.code !== "string") continue;
      const patterns: string[] = [];
      const visit = (value: unknown, key: string) => {
        if (typeof value === "string") {
          if (/pattern|regex|match|allow|ignore|filter|format|except|message|term/i.test(key)) patterns.push(value);
        } else if (Array.isArray(value)) value.forEach(item => visit(item, key));
        else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, k);
      };
      visit(test.options, "");
      if (!patterns.length) continue;
      const pieces = new Set<string>([...test.code.split("\n"), ...(test.code.match(/[\p{ID_Continue}$]+/gu) ?? [])]);
      for (const pattern of patterns) {
        for (const flags of ["", "u"]) {
          for (const text of [...pieces].slice(0, 30)) {
            const key = `${pattern}\0${flags}\0${text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            yield [pattern, flags, text, 0];
          }
        }
      }
    }
  }
}

/** Reports what `RegExp.prototype.exec` is called with. Some tests go through all code points: the first calls will do. */
const SPY = `(function () {
  const { exec } = RegExp.prototype, { apply, get } = Reflect, { getPrototypeOf } = Object, { isInteger } = Number;
  const prototype = RegExp.prototype, log = __log;
  let calls = 0;
  prototype.exec = function (text) {
    if (++calls >= 1000) prototype.exec = exec;
    try {
      if (typeof text === "string" && text.length < 2000 && getPrototypeOf(this) === prototype) {
        const flags = get(prototype, "flags", this), lastIndex = this.lastIndex;
        if (typeof lastIndex === "number" && isInteger(lastIndex) && lastIndex >= 0) {
          log(get(prototype, "source", this), flags, text, flags.includes("g") || flags.includes("y") ? lastIndex : 0);
        }
      }
    } catch {}
    return apply(exec, this, [text]);
  };
})();`;

function* test262(root: string): Iterable<Case> {
  const harness = ["assert.js", "sta.js", "compareArray.js", "propertyHelper.js", "regExpUtils.js", "nativeFunctionMatcher.js", "isConstructor.js", "deepEqual.js", "wellKnownIntrinsicObjects.js"]
    .map(name => readFileSync(join(root, "harness", name), "utf8"))
    .join("\n");
  const seen = new Set<string>();
  const log: Case[] = [];
  const dirs = [
    "test/built-ins/RegExp",
    "test/annexB/built-ins/RegExp",
    "test/staging/sm/RegExp",
    "test/language/literals/regexp",
    ...["match", "matchAll", "replace", "replaceAll", "search", "split"].map(m => `test/built-ins/String/prototype/${m}`),
  ];
  for (const dir of dirs) {
    for (const file of files(join(root, dir), /\.js$/)) {
      // These match strings of all the code points of a property. charset.ts covers them.
      if (file.includes("property-escapes/generated") || file.includes("_FIXTURE")) continue;
      const source = readFileSync(file, "utf8");
      if (/flags:.*\b(module|async)\b/.test(source) || /negative:/.test(source)) continue;
      // A realm of its own: tests change the built-ins.
      const context = createContext({
        __log: (source: string, flags: string, text: string, lastIndex: number) => log.push([source, flags, text, lastIndex]),
      });
      try {
        runInContext(`${harness}\n${SPY}\nvar $262 = { createRealm() { throw new Test262Error("no realms"); } };\n${source}`, context, {
          timeout: 5000,
        });
      } catch {}
      for (const it of log.splice(0)) {
        const key = it.join("\0");
        if (seen.has(key)) continue;
        seen.add(key);
        yield it;
      }
    }
  }
}

// == random patterns ==

function fuzzPattern(flags: string): string {
  const unicode = /[uv]/.test(flags);
  let groups = 0;
  const names: string[] = [];
  const char = () => pick([..."abcABC", "a", "b", "x", "_", "0", " ", "-", "é", "É", "ß", "ſ", "K", "k", "s", "σ", "ς", "\\n", "\\.", "\\u00e9", "\\x41", "\u{1f4a9}", "\u{10400}", "\u{10428}", unicode ? "\\u{1f4a9}" : "\\ud83d", "\\udca9"]);
  const set = () => pick(["\\d", "\\D", "\\w", "\\W", "\\s", "\\S", ...(unicode ? ["\\p{L}", "\\P{L}", "\\p{Lu}", "\\p{Ll}", "\\P{Lu}", "\\p{Script=Greek}", "\\p{ASCII}", "\\p{Any}"] : [])]);
  const classItem = (): string => {
    switch (random(6)) {
      case 0:
        return set();
      case 1: {
        const [a, b] = [pick([..."aAk0"]), pick([..."zZs9"])];
        return a < b ? `${a}-${b}` : `${b}-${a}`;
      }
      case 2:
        return pick(["\\b", "\\-", "^", "\\]", "é-ü", "À-Þ", "\\u0100-\\u017f", unicode ? "\u{10400}-\u{1044f}" : "\\ud800-\\udbff"]);
      default:
        return char().replace(/^[-\]\\^]$/, "\\$&").replace(/^ $/, " ");
    }
  };
  const klass = (depth: number): string => {
    const negate = random(4) === 0 ? "^" : "";
    if (flags.includes("v")) {
      const operand = (): string => {
        switch (random(6)) {
          case 0:
            return depth < 2 ? klass(depth + 1) : set();
          case 1:
            return set();
          case 2:
            return negate ? "a" : pick(["\\q{abc|d|}", "\\q{ab|AB}", "\\q{k}", "\\q{ß|ss}"]);
          default:
            return pick([..."abcABCks_0", "é", "ſ", "K"]);
        }
      };
      switch (random(4)) {
        case 0:
          return `[${negate}${operand()}&&${operand()}]`;
        case 1:
          return `[${negate}${operand()}--${operand()}]`;
        default: {
          let out = "";
          for (let n = random(4); n >= 0; n--) out += random(3) ? operand() : pick(["a-z", "A-Z", "0-9", "é-ü"]);
          return `[${negate}${out}]`;
        }
      }
    }
    let out = "";
    for (let n = random(4); n > 0; n--) out += classItem();
    return `[${negate}${out}]`;
  };
  const quantifier = () => pick(["*", "+", "?", "*?", "+?", "??", "{2}", "{0,2}", "{1,}", "{2,3}?", "{0}", "{1,2}", "{0,1}?"]);
  const atom = (depth: number, behind: boolean): string => {
    switch (random(depth > 3 ? 8 : 16)) {
      case 0:
      case 1:
      case 2:
      case 3:
        return char();
      case 4:
        return ".";
      case 5:
        return set();
      case 6:
      case 7:
        return klass(0);
      case 8:
        groups++;
        return `(${disjunction(depth + 1, behind)})`;
      case 9:
        return `(?:${disjunction(depth + 1, behind)})`;
      case 10: {
        const name = `n${names.length}`;
        names.push(name);
        groups++;
        return `(?<${name}>${disjunction(depth + 1, behind)})`;
      }
      case 11:
        return `(?${pick(["=", "!"])}${disjunction(depth + 1, false)})`;
      case 12:
        return `(?<${pick(["=", "!"])}${disjunction(depth + 1, true)})`;
      case 13:
        return groups ? `\\${1 + random(groups + (unicode ? 0 : 1))}` : char();
      case 14:
        return names.length ? `\\k<${pick(names)}>` : char();
      default:
        return `(?${pick(["i", "s", "m", "-i", "i-s", "-m", "im", "s-i"])}:${disjunction(depth + 1, behind)})`;
    }
  };
  const term = (depth: number, behind: boolean): string => {
    if (random(10) === 0) return pick(["^", "$", "\\b", "\\B"]);
    const it = atom(depth, behind);
    if (random(3)) return it;
    if (/^\(\?<?[=!]/.test(it) && (unicode || it.startsWith("(?<"))) return it;
    return it + quantifier();
  };
  const alternative = (depth: number, behind: boolean): string => {
    let out = "";
    for (let n = random(4); n > 0; n--) out += term(depth, behind);
    return out;
  };
  function disjunction(depth: number, behind: boolean): string {
    let out = alternative(depth, behind);
    for (let n = random(6) === 0 ? 2 : random(3) === 0 ? 1 : 0; n > 0; n--) out += `|${alternative(depth, behind)}`;
    return out;
  }
  return disjunction(0, false);
}

function* fuzz(count: number): Iterable<Case> {
  const letters = [..."aaabbbcABCxks_0 -", "é", "É", "ß", "ſ", "K", "σ", "ς", "Σ", "\n", "\u{1f4a9}", "\u{10400}", "\u{10428}", "\ud83d", "\udca9", "ss", "abc", "d"];
  for (let i = 0; i < count; i++) {
    let flags = pick(["", "", "u", "u", "v", "i", "iu", "iv", "m", "s", "y", "g", "imsu", "ims", "gi", "msv"]);
    const pattern = fuzzPattern(flags);
    try {
      new RegExp(pattern, flags);
    } catch {
      continue;
    }
    for (let n = 0; n < 4; n++) {
      let text = "";
      for (let k = random(9); k > 0; k--) text += pick(letters);
      yield [pattern, flags, text, /[gy]/.test(flags) ? random(text.length + 1) : 0];
      yield [pattern, flags, sample(pattern), 0];
    }
  }
}

/** The cases of a source as it is written on the command line: see exec.ts. */
export function casesOf(source: string): Iterable<Case> | AsyncIterable<Case> {
  const [kind, ...spec] = source.split(":");
  switch (kind) {
    case "literals":
      return literals(spec.join(":"));
    case "fixtures":
      return fixtures(spec.join(":"));
    case "test262":
      return test262(spec.join(":"));
    case "file":
      return readFileSync(spec.join(":"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    default:
      return fuzz(Number(spec[0]));
  }
}
