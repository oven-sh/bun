// Compares what `bun_lint::selector` matches with the nodes that ESLint calls a listener with.
//
//   bun match.ts <eslint> <@typescript-eslint/parser> <bun-lint> <scratch dir> <inputs.jsonl>
//       [--parser=espree|typescript] [--per-input=n] [--seed=n] [--limit=n] [--selector=s]..
//
// <inputs.jsonl>: what ../ast/collect.ts writes. For each input, selectors are generated from its own AST, so that most of them
// match something, a rule with one listener for each is run by ESLint, and the (selector, type, range) of the calls are
// compared with those of `bun-lint selector match`: as sets, and in the order of reports.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flags = (name: string) => args.filter(it => it.startsWith(`--${name}=`)).map(it => it.slice(name.length + 3));
const [eslintPath, parserPath, binary, scratch, inputs] = args.filter(it => !it.startsWith("--"));
const parserName = flags("parser")[0] ?? "espree";
const perInput = Number(flags("per-input")[0] ?? 24);
const limit = Number(flags("limit")[0] ?? Infinity);
const fixed = flags("selector");
let state = Number(flags("seed")[0] ?? 1);
const random = (n: number) => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) >>> 8) % n;
const pick = <T>(all: readonly T[]): T => all[random(all.length)];
const chance = (percent: number) => random(100) < percent;

const { Linter } = require(resolve(eslintPath, "lib/api.js"));
const tsParser = parserName === "typescript" ? require(resolve(parserPath)) : undefined;

// ───────────────────────────── selectors for an AST ─────────────────────────────

type Node = { type: string; range: [number, number]; [key: string]: any };
type Place = { node: Node; parent?: Place; key?: string; list?: (Node | null)[]; index?: number };

const isNode = (it: any): it is Node => it !== null && typeof it === "object" && typeof it.type === "string";

function places(ast: Node, visitorKeys: Record<string, string[]>): Place[] {
  const all: Place[] = [];
  const open: Place[] = [{ node: ast }];
  while (open.length > 0) {
    const place = open.pop()!;
    all.push(place);
    placeOf.set(place.node, place);
    for (const key of visitorKeys[place.node.type] ?? []) {
      const value = place.node[key];
      if (Array.isArray(value)) {
        value.forEach((node, index) => isNode(node) && open.push({ node, parent: place, key, list: value, index }));
      } else if (isNode(value)) {
        open.push({ node: value, parent: place, key });
      }
    }
  }
  return all;
}

const quote = (text: string) =>
  chance(50) ? `'${text.replace(/[\\']/g, "\\$&")}'` : `"${text.replace(/[\\"]/g, "\\$&")}"`;
const isPlainName = (text: string) => /^[^ [\],():#!=><~+.'"/0-9][^ [\],():#!=><~+.]*$/.test(text) && !text.startsWith("type(");
const literal = (value: unknown) =>
  typeof value === "string"
    ? isPlainName(value) && chance(40) ? value : quote(value)
    : typeof value === "number" && !/^\d*\.?\d+$/.test(String(value)) ? quote(String(value)) : String(value);
const SKIPPED = new Set(["type", "range", "loc", "parent", "start", "end", "tokens", "comments"]);

const placeOf = new WeakMap<Node, Place>();

/// A path from `node` to something, and what is there.
function path(node: Node): [string, unknown] {
  const keys: string[] = [];
  let at: any = node;
  for (let depth = 0; depth < 5; depth++) {
    let names: string[];
    if (typeof at === "string") {
      if (!chance(12)) break;
      names = ["length", "0", "1", "7"];
    } else if (at instanceof RegExp) {
      if (!chance(50)) break;
      names = ["source", "flags", "global", "ignoreCase", "unicode", "sticky", "lastIndex", "foo"];
    } else if (at === null || typeof at !== "object") {
      break;
    } else if (Array.isArray(at)) {
      names = [...at.keys()].map(String).concat("length", String(at.length));
    } else if (isNode(at) && chance(10)) {
      names = ["type", "parent", "range", "loc", "start", "end"];
    } else {
      names = Object.keys(at).filter(it => !isNode(at) || !SKIPPED.has(it));
    }
    if (names.length === 0) break;
    const key = pick(names);
    keys.push(key);
    at = key === "parent" && isNode(at) ? (placeOf.get(at)?.parent?.node ?? null) : at[key];
    if (chance(35)) break;
  }
  if (keys.length === 0) return ["type", node.type];
  return [keys.join("."), at];
}

function attribute(place: Place): string {
  const [name, value] = path(place.node);
  const space = chance(15) ? " " : "";
  const isPrimitive = value === null || ["string", "number", "boolean", "undefined", "bigint"].includes(typeof value);
  switch (random(isPrimitive ? 10 : 4)) {
    case 0:
    case 1:
      return `[${space}${name}${space}]`;
    case 2:
      return `[${name}${pick(["=", "!="])}type(${pick(["string", "number", "boolean", "object", "undefined", "bigint", "function"])})]`;
    case 3:
      return `[${name}${pick(["=", "!="])}${pick(["/./", "/^[a-z]/i", "/e$/", "/\\d/u", "/^(?:true|null|undefined)$/", "/object/"])}]`;
    case 4:
      return `[${name}${space}${pick(["<", "<=", ">", ">="])}${space}${chance(50) ? literal(value) : pick(["0", "1", "2", "10", "'a'", "m", "1.5"])}]`;
    case 5:
      if (typeof value === "string" && value.length > 0 && !/[\n\r\u2028\u2029]/.test(value)) {
        const piece = value.slice(0, 1 + random(3)).replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
        return `[${name}${pick(["=", "!="])}/^${piece}/${pick(["", "i", "u", "s"])}]`;
      }
    default:
      return `[${name}${space}${pick(["=", "=", "=", "!="])}${space}${chance(85) ? literal(value) : pick(["foo", "0", "true", "null", "undefined", "'[object Object]'"])}]`;
  }
}

const CLASSES = [":statement", ":expression", ":declaration", ":function", ":pattern", ":Function", ":STATEMENT"];

function typeName(node: Node): string {
  if (chance(4)) return node.type.toLowerCase();
  if (chance(2)) return "#" + node.type;
  return node.type;
}

/// A selector without combinators that is likely to match the node at `place`.
function compound(place: Place, all: Place[], depth: number): string {
  const atoms: string[] = [];
  switch (random(10)) {
    case 0:
      atoms.push("*");
      break;
    case 1:
      atoms.push(pick(CLASSES));
      break;
    case 2:
      break;
    default:
      atoms.push(typeName(place.node));
  }
  while (chance(atoms.length === 0 ? 100 : 40)) {
    switch (random(depth > 2 ? 6 : 12)) {
      case 0:
      case 1:
      case 2:
        atoms.push(attribute(place));
        break;
      case 3:
        if (place.key !== undefined) {
          const outer = place.parent?.key !== undefined && chance(25) ? place.parent.key + "." : "";
          atoms.push("." + outer + place.key);
        } else atoms.push(".body");
        break;
      case 4:
        if (place.list !== undefined) {
          atoms.push(chance(50) ? `:nth-child(${place.index! + 1})` : `:nth-last-child(${place.list.length - place.index!})`);
        } else atoms.push(pick([":first-child", ":last-child", ":nth-child(2)", ":nth-last-child(2)", ":nth-child(0)"]));
        break;
      case 5:
        atoms.push(pick([":first-child", ":last-child"]));
        break;
      case 6:
        atoms.push(`:not(${list(pick(all), all, depth + 1)})`);
        break;
      case 7:
        atoms.push(`${pick([":matches", ":is"])}(${list(place, all, depth + 1)})`);
        break;
      default: {
        // Something below it.
        const below = all.filter(it => it.parent === place);
        const inner = below.length > 0 ? pick(below) : pick(all);
        const deeper = all.filter(it => it.parent === inner);
        const target = deeper.length > 0 && chance(40) ? pick(deeper) : inner;
        atoms.push(`:has(${pick(["", "", "> ", ">", "+ ", "~ ", " "])}${complex(target, all, depth + 2)})`);
      }
    }
  }
  if (atoms.length > 1 && chance(10)) atoms.reverse();
  // A name after anything but `*`, `]` and `)` would be read as part of what precedes it.
  for (let i = 1; i < atoms.length; i++) {
    if (/^[A-Za-z]/.test(atoms[i]) && !/[*\])]$/.test(atoms[i - 1])) atoms[i] = "#" + atoms[i];
  }
  return atoms.join("");
}

/// A selector with combinators that is likely to match the node at `place`.
function complex(place: Place, all: Place[], depth: number): string {
  let selector = compound(place, all, depth);
  let at = place;
  while (depth < 4 && chance(45)) {
    const space = pick(["", " ", "  "]);
    const bang = (percent: number) => (chance(percent) ? "!" : "");
    const kind = random(10);
    if (kind < 3 && at.parent !== undefined) {
      at = at.parent;
      selector = `${bang(3)}${compound(at, all, depth + 1)}${space}>${space}${selector}`;
    } else if (kind < 6 && at.parent !== undefined) {
      do at = at.parent!; while (at.parent !== undefined && chance(50));
      selector = `${compound(at, all, depth + 1)} ${space}${selector}`;
    } else if (at.list !== undefined && at.list.length > 1) {
      const isAdjacent = chance(50);
      const index = isAdjacent ? at.index! - 1 : random(at.list.length);
      const sibling = all.find(it => it.list === at.list && it.index === index);
      if (sibling === undefined) break;
      selector = isAdjacent
        ? `${compound(sibling, all, depth + 1)}${space}+${space}${selector.startsWith("!") ? "" : bang(15)}${selector}`
        : `${bang(15)}${compound(sibling, all, depth + 1)}${space}~${space}${selector}`;
      at = sibling;
    } else break;
    depth++;
  }
  return selector;
}

function list(place: Place, all: Place[], depth: number): string {
  const items = [complex(place, all, depth)];
  while (chance(30)) items.push(complex(pick(all), all, depth));
  return items.join(pick([",", ", ", " , "]));
}

function generate(ast: Node, visitorKeys: Record<string, string[]>): string[] {
  if (fixed.length > 0) return fixed;
  const all = places(ast, visitorKeys);
  const selectors = new Set<string>();
  if (chance(20)) selectors.add("*");
  for (let i = 0; i < perInput; i++) {
    let selector = list(pick(all), all, 0);
    if (chance(5)) selector = " " + selector + " ";
    if (chance(6)) selector += ":exit";
    // Half of a surrogate pair does not survive the trip through UTF-8.
    if (selector.isWellFormed()) selectors.add(selector);
  }
  return [...selectors];
}

// ───────────────────────────── what ESLint does ─────────────────────────────

type Call = [number, string, number, number];
const linter = new Linter({ configType: "flat" });

function expected(filename: string, code: string, sourceType: string): { selectors: string[]; calls: Call[] } | { error: string } {
  let selectors: string[] = [];
  const calls: Call[] = [];
  const rule = {
    create(context: any) {
      selectors = generate(context.sourceCode.ast, context.sourceCode.visitorKeys);
      const listeners = selectors.map((it, i) => [it, (node: Node) => calls.push([i, node.type, ...node.range])]);
      return Object.fromEntries(listeners);
    },
  };
  const config = {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { oracle: { rules: { probe: rule } } },
    rules: { "oracle/probe": "error" },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ...(tsParser ? { parser: tsParser } : { ecmaVersion: "latest" }),
      sourceType,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  };
  try {
    const messages = linter.verify(code, [config], { filename, allowInlineConfig: false });
    if (messages.some((it: any) => it.fatal)) return { error: "parse" };
    if (selectors.length === 0) return { error: messages[0]?.message ?? "the rule did not run" };
  } catch (error: any) {
    return { error: String(error.message).split("\n")[0] };
  }
  return { selectors, calls };
}

// ───────────────────────────── the comparison ─────────────────────────────

const lines = readFileSync(inputs, "utf8").split("\n").filter(Boolean);
const cases: string[] = [];
const wanted = new Map<string, { selectors: string[]; calls: Call[]; code: string }>();
let rejected = 0, threw = 0;
for (const line of lines) {
  if (cases.length >= limit) break;
  const { id, filename, code, sourceType, parser } = JSON.parse(line);
  if (parserName === "espree" && (!/\.[cm]?jsx?$/.test(filename) || (parser && parser !== "espree"))) continue;
  const want = expected(filename, code, sourceType);
  if ("error" in want) {
    if (want.error === "parse") rejected++;
    else if (threw++ < 5) console.log("ESLint throws", id, want.error);
    continue;
  }
  wanted.set(id, { ...want, code });
  cases.push(JSON.stringify({ id, filename, code, sourceType, parser: parserName, selectors: want.selectors }));
}
const path_ = join(scratch, `cases-${parserName}.jsonl`);
writeFileSync(path_, cases.join("\n") + "\n");
const run = Bun.spawnSync([binary, "selector", "match", path_], { maxBuffer: 1 << 31 } as any);

const key = (it: Call) => it.join(" ");
let compared = 0, differentInputs = 0, errors = 0, selectorCount = 0, callCount = 0, differentSelectors = 0, differentOrder = 0, differentFromEslint = 0, matching = 0;
const byType = new Map<string, number>();
for (const line of run.stdout.toString().split("\n").filter(Boolean)) {
  const got = JSON.parse(line);
  const want = wanted.get(got.id)!;
  if (got.error !== undefined) {
    if (got.error !== "parse" && errors++ < 10) console.log("ERROR", got.id, got.error);
    continue;
  }
  compared++;
  selectorCount += want.selectors.length;
  callCount += want.calls.length;
  matching += new Set(want.calls.map(it => it[0])).size;
  // The key and the value of `{ a }` are two nodes of the same type at the same place.
  const without = (all: Call[], others: Call[]) => {
    const counts = new Map<string, number>();
    for (const it of others) counts.set(key(it), (counts.get(key(it)) ?? 0) + 1);
    return all.filter(it => {
      const left = counts.get(key(it)) ?? 0;
      counts.set(key(it), left - 1);
      return left <= 0;
    });
  };
  const missing = without(want.calls, got.matches);
  const extra = without(got.matches, want.calls);
  if (missing.length + extra.length > 0) {
    const bad = new Set([...missing, ...extra].map(it => it[0]));
    differentSelectors += bad.size;
    for (const it of [...missing, ...extra]) byType.set(it[1], (byType.get(it[1]) ?? 0) + 1);
    if (differentInputs++ < 12) {
      console.log("DIFFERENT", got.id, want.code.length < 200 ? JSON.stringify(want.code) : "");
      for (const i of [...bad].slice(0, 3)) {
        console.log("  selector", JSON.stringify(want.selectors[i]));
        console.log("    missing", JSON.stringify(missing.filter(it => it[0] === i).slice(0, 4)));
        console.log("    extra  ", JSON.stringify(extra.filter(it => it[0] === i).slice(0, 4)));
      }
    }
  } else {
    // ESLint sorts what is reported by where it starts, and leaves the rest in the order of the calls. The runner here also
    // puts what ends later first.
    const inOrder = (alsoByEnd: boolean) =>
      want.calls
        .map((it, i) => [it, i] as const)
        .sort((x, y) => x[0][2] - y[0][2] || (alsoByEnd ? y[0][3] - x[0][3] : 0) || x[1] - y[1])
        .map(it => key(it[0]));
    const actual = (got.matches as Call[]).map(key).join("\n");
    if (inOrder(false).join("\n") !== actual) differentFromEslint++;
    const sorted = inOrder(true);
    if (sorted.join("\n") !== actual && differentOrder++ < 5) {
      const at = sorted.findIndex((it, i) => it !== key(got.matches[i]));
      console.log("ORDER", got.id, JSON.stringify(want.code.slice(0, 200)), "\n  expected", sorted.slice(at, at + 3), "\n  actual  ", got.matches.slice(at, at + 3).map(key));
      console.log("  selectors", [...new Set(sorted.slice(at, at + 3).map(it => want.selectors[Number(it.split(" ")[0])]))]);
    }
  }
}
if (byType.size > 0) console.log("by type:", [...byType].sort((x, y) => y[1] - x[1]).slice(0, 15));
console.log(
  `${parserName}: ${compared} inputs compared (${rejected} ESLint rejects, ${threw} it throws for, ${errors} errors here), ` +
    `${selectorCount} selectors of which ${matching} match something, ${callCount} matches; ` +
    `different: ${differentInputs} inputs, ${differentSelectors} selectors; order differs in ${differentOrder} inputs (${differentFromEslint} before the runner's sort by end)`,
);
process.exit(differentInputs + errors + differentOrder > 0 ? 1 : 0);
