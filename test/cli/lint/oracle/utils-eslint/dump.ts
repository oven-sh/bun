// What `@eslint-community/eslint-utils` says about every node of each case, in the format of `bun-lint utils-eslint dump`.
//
//   ESLINT_DIR=<eslint checkout> TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> node dump.ts cases.jsonl > expected.jsonl
//
// The cases are those of `cases.ts`. Offsets are in bytes of UTF-8. A line is `{ id, facts: ["name|type|start|end|value"] }`.
//
// `ChainExpression` is not a node in `bun lint`: what is asked of the member access or the call in it is asked of the
// `ChainExpression` here, and reported under the type of what is in it.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
const typescriptEslintDir = process.env.TYPESCRIPT_ESLINT_DIR;
if (!eslintDir || !typescriptEslintDir) throw new Error("set ESLINT_DIR and TYPESCRIPT_ESLINT_DIR");
const fromEslint = createRequire(join(eslintDir, "package.json"));
const { Linter } = fromEslint("./lib/api.js");
const utils = fromEslint("@eslint-community/eslint-utils");
const typescriptParser = fromEslint(join(typescriptEslintDir, "packages/parser/dist/index.js"));
const { READ, CALL, CONSTRUCT, ESM, ReferenceTracker } = utils;

// How the functions and the objects of the standard library are called.
const builtinNames =
  "Array ArrayBuffer BigInt BigInt64Array BigUint64Array Boolean DataView Date decodeURI decodeURIComponent encodeURI encodeURIComponent escape Float32Array Float64Array Function isFinite isNaN isPrototypeOf JSON Map Math Number Object parseFloat parseInt Promise Proxy Reflect RegExp Set String Symbol Uint16Array Uint32Array Uint8Array Uint8ClampedArray unescape WeakMap WeakSet".split(
    " ",
  );
const pathOf = new Map<unknown, string>();
const isObject = (it: unknown) => (typeof it === "object" && it !== null) || typeof it === "function";
for (const name of builtinNames) pathOf.set((globalThis as any)[name], name);
for (const [path, it] of [
  ["String.prototype.trimStart", String.prototype.trimStart],
  ["String.prototype.trimEnd", String.prototype.trimEnd],
  ["Set.prototype.values", Set.prototype.values],
] as const) {
  pathOf.set(it, path);
}
for (const name of builtinNames) {
  const members = (owner: any, path: string) => {
    for (const key of Object.getOwnPropertyNames(owner)) {
      const value = Object.getOwnPropertyDescriptor(owner, key)!.value;
      if (typeof value === "function" && !pathOf.has(value)) pathOf.set(value, `${path}.${key}`);
    }
  };
  const it = (globalThis as any)[name];
  members(it, name);
  if (isObject(it.prototype)) members(it.prototype, `${name}.prototype`);
}

const quote = (text: string) =>
  `"${text.replace(/[^ !#-[\]-~]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;

function show(it: any): string {
  switch (typeof it) {
    case "undefined":
    case "boolean":
      return String(it);
    case "number":
      return Object.is(it, -0) ? "-0" : String(it);
    case "string":
      return quote(it);
    case "bigint":
      return `${it}n`;
    case "symbol":
      return Symbol.keyFor(it) === undefined ? `@@${it.description}` : `Symbol.for(${quote(Symbol.keyFor(it)!)})`;
    case "function":
      return pathOf.get(it) ?? "<other>";
  }
  if (it === null) return "null";
  if (pathOf.has(it)) return pathOf.get(it)!;
  const prototype = Object.getPrototypeOf(it);
  if (prototype === RegExp.prototype) return `/${quote(it.source)}/${it.flags}`;
  if (prototype === Array.prototype) return `[${Array.from(it, (_, i) => (i in it ? show(it[i]) : "<hole>")).join(",")}]`;
  if (prototype === Map.prototype) return `Map{${[...it].map(([key, value]) => `${show(key)}=>${show(value)}`).join(",")}}`;
  if (prototype === Set.prototype) return `Set{${[...it].map(show).join(",")}}`;
  const tag = Object.prototype.toString.call(it);
  if (/^\[object (Array|Map|Set) Iterator\]$/.test(tag)) return `${tag.slice(8, -10)}Iterator[${[...it].map(show).join(",")}]`;
  if (prototype === Object.prototype) {
    return `{${Reflect.ownKeys(it)
      .map(key => `${show(key)}:${show(it[key])}`)
      .join(",")}}`;
  }
  return "<other>";
}

let facts: string[] = [];
let names: string[] = [];

const rule = {
  create(context: any) {
    const sourceCode = context.sourceCode;
    const code: string = sourceCode.text;
    const toByte = new Uint32Array(code.length + 1);
    for (let i = 0, at = 0; i < code.length; i++) {
      toByte[i] = at;
      const c = code.charCodeAt(i);
      const isPair = c >= 0xd800 && c < 0xdc00 && (code.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
      if (isPair) {
        toByte[i + 1] = at;
        i++;
        at += 4;
      } else at += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      toByte[i + 1] = at;
    }
    const text = (it: unknown) => (it === null || it === undefined ? "none" : quote(String(it)));
    const index = (loc: any) => toByte[sourceCode.getIndexFromLoc(loc)];
    const where = (node: any) => `${node.type}|${toByte[node.range[0]]}|${toByte[node.range[1]]}`;
    const globalScope = sourceCode.scopeManager.scopes[0];

    function visit(node: any) {
      const add = (name: string, value: () => unknown) => {
        let result;
        try {
          result = value();
        } catch {
          return;
        }
        facts.push(`${name}|${where(node)}|${result}`);
      };
      if (node.type === "Program" || node.type === "ChainExpression") return;
      const it = node.parent.type === "ChainExpression" ? node.parent : node;
      const value = (scope: unknown) => {
        const result = utils.getStaticValue(it, scope);
        return result ? show(result.value) : "none";
      };
      add("static", () => value(globalScope));
      add("staticNoScope", () => value(null));
      add("string", () => text(utils.getStringIfConstant(it, globalScope)));
      add("sideEffect", () =>
        [0, 1, 2, 3]
          .map(bits =>
            Number(utils.hasSideEffect(it, sourceCode, { considerGetters: !!(bits & 1), considerImplicitTypeConversion: !!(bits & 2) })),
          )
          .join(""),
      );
      add("parenthesized", () => [1, 2, 3].map(times => Number(utils.isParenthesized(times, it, sourceCode))).join(""));
      if (["MemberExpression", "Property", "MethodDefinition", "PropertyDefinition"].includes(node.type)) {
        add("propertyName", () => `${text(utils.getPropertyName(node, globalScope))} ${text(utils.getPropertyName(node))}`);
      }
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
        add("functionHead", () => {
          const loc = utils.getFunctionHeadLocation(node, sourceCode);
          return `${index(loc.start)}-${index(loc.end)}`;
        });
        add("functionName", () => `${utils.getFunctionNameWithKind(node)} / ${utils.getFunctionNameWithKind(node, sourceCode)}`);
      }
    }

    function track(name: string, references: Iterable<any>) {
      const found = new Map<string, string[]>();
      for (const { node, path, type } of references) {
        const kind = type === READ ? "read" : type === CALL ? "call" : "construct";
        const key = where(node);
        found.set(key, [...(found.get(key) ?? []), `${kind} ${path.join(".")}`]);
      }
      for (const [key, all] of found) facts.push(`${name}|${key}|${all.sort().join(", ")}`);
    }

    return {
      "*": visit,
      "Program:exit"() {
        const level = (next: object) =>
          Object.fromEntries(names.map(name => [name, { [READ]: true, [CALL]: true, [CONSTRUCT]: true, ...next }]));
        const map = level(level(level({})));
        const esm = Object.fromEntries(names.map(name => [name, { ...map[name], [ESM]: true }]));
        const tracker = new ReferenceTracker(globalScope);
        track("trackGlobal", tracker.iterateGlobalReferences(map));
        track("trackCjs", tracker.iterateCjsReferences(map));
        track("trackEsmStrict", tracker.iterateEsmReferences(map));
        track("trackEsmLegacy", new ReferenceTracker(globalScope, { mode: "legacy" }).iterateEsmReferences(map));
        track("trackEsm", tracker.iterateEsmReferences(esm));
      },
    };
  },
};

const linter = new Linter({ configType: "flat" });
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const it = JSON.parse(line);
  facts = [];
  names = it.names;
  const isJavaScript = /\.[cm]?jsx?$/.test(it.filename);
  const messages = linter.verify(
    it.code,
    {
      files: ["**"],
      linterOptions: { reportUnusedDisableDirectives: "off" },
      languageOptions: {
        ...(isJavaScript ? { ecmaVersion: it.ecmaVersion ?? "latest" } : { parser: typescriptParser }),
        sourceType: it.sourceType ?? "module",
        parserOptions: { ecmaFeatures: { jsx: it.jsx || /x$/.test(it.filename) } },
        globals: Object.fromEntries(names.map(name => [name, "readonly"])),
      },
      plugins: { oracle: { rules: { dump: rule } } },
      rules: { "oracle/dump": "error" },
    },
    { filename: it.filename },
  );
  console.log(JSON.stringify(messages.some((message: any) => message.fatal) ? { id: it.id, error: true } : { id: it.id, facts }));
}
