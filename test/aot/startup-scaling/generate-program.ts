export type Files = Record<string, string>;

export type Kind = {
  name: string;
  maxCount?: number;
  largeCount?: number;
  isSlowToCompile?: boolean;
  files(folder: string, first: number, count: number): Files;
};

const expressionsPerFunction = 50;
const declarationsPerModule = 1000;
const modulesPerBarrel = 100;
const unknownArray = ": unknown[]";
const propertyNames = "abcdefghijklmnopqrst".split("");

function shapeProperties(index: number): string[] {
  const remaining = [...propertyNames];
  const names: string[] = [];
  for (let size = propertyNames.length; size > propertyNames.length - 4; size--) {
    names.push(remaining.splice(index % size, 1)[0]);
    index = Math.floor(index / size);
  }
  return names;
}

const range = (first: number, count: number) => Array.from({ length: count }, (_, index) => first + index);

function wrapInFunctions(prefix: string, parameters: string, expressions: string[], returnType = ""): { source: string; names: string[] } {
  let source = "";
  const names: string[] = [];
  for (let first = 0; first < expressions.length; first += expressionsPerFunction) {
    const name = `${prefix}${first / expressionsPerFunction}`;
    names.push(name);
    source += `export function ${name}(${parameters})${returnType} {\n  return [\n    ${expressions.slice(first, first + expressionsPerFunction).join(",\n    ")},\n  ];\n}\n`;
  }
  return { source, names };
}

function useAllFunction(calls: string[], returnType = ""): string {
  return `export function useAll()${returnType} {\n  return [${calls.map(call => `\n    ${call},`).join("")}\n  ];\n}\n`;
}

type DeclarationKind = {
  name: string;
  typed: boolean;
  header?: string;
  declaration(index: number): string;
  use(index: number): string;
  splitIntoModules?: boolean;
  isSlowToCompile?: boolean;
  largeCount?: number;
};

function declarationKind({ name, typed, header = "", declaration, use, splitIntoModules, isSlowToCompile, largeCount }: DeclarationKind): Kind {
  const extension = typed ? "ts" : "js";
  const returnType = typed ? unknownArray : "";
  const moduleSource = (indices: number[]) => {
    const uses = wrapInFunctions("use", "", indices.map(use), returnType);
    return header + indices.map(index => declaration(index) + "\n").join("") + uses.source + useAllFunction(uses.names.map(name => `${name}()`), returnType);
  };
  return {
    name,
    isSlowToCompile,
    largeCount,
    files(folder, first, count) {
      if (!splitIntoModules) return { [`${folder}/index.${extension}`]: moduleSource(range(first, count)) };
      const files: Files = {};
      const parts: string[] = [];
      for (let start = 0; start < count; start += declarationsPerModule) {
        const part = `part${start / declarationsPerModule}`;
        parts.push(part);
        files[`${folder}/${part}.${extension}`] = moduleSource(range(first + start, Math.min(declarationsPerModule, count - start)));
      }
      files[`${folder}/index.${extension}`] = parts.map(part => `import * as ${part} from "./${part}";\n`).join("") + useAllFunction(parts.map(part => `${part}.useAll()`), returnType);
      return files;
    },
  };
}

type ExpressionKind = {
  name: string;
  typed: boolean;
  parameter?: string;
  argument?: string;
  expression(index: number): string;
  extraFiles?: Files;
};

function expressionKind({ name, typed, parameter = "", argument = "", expression, extraFiles = {} }: ExpressionKind): Kind {
  return {
    name,
    files(folder, first, count) {
      const returnType = typed ? unknownArray : "";
      const functions = wrapInFunctions("group", parameter, range(first, count).map(expression), returnType);
      const files: Files = { [`${folder}/index.${typed ? "ts" : "js"}`]: functions.source + useAllFunction(functions.names.map(name => `${name}(${argument})`), returnType) };
      for (const [path, source] of Object.entries(extraFiles)) files[`${folder}/${path}`] = source;
      return files;
    },
  };
}

type ModuleKind = {
  name: string;
  extension: string;
  barrelExtension?: string;
  source(index: number): string;
  barrel(members: number[]): string;
  index(barrels: string[]): string;
};

function moduleKind({ name, extension, barrelExtension = extension, source, barrel, index }: ModuleKind): Kind {
  return {
    name,
    isSlowToCompile: true,
    files(folder, first, count) {
      const files: Files = {};
      const barrels: string[] = [];
      for (let start = 0; start < count; start += modulesPerBarrel) {
        const members = range(first + start, Math.min(modulesPerBarrel, count - start));
        for (const member of members) files[`${folder}/m${member}.${extension}`] = source(member);
        barrels.push(`barrel${start / modulesPerBarrel}`);
        files[`${folder}/${barrels.at(-1)}.${barrelExtension}`] = barrel(members);
      }
      files[`${folder}/index.${barrelExtension}`] = index(barrels);
      return files;
    },
  };
}

const objectLiteral = (index: number) => `{ ${shapeProperties(index).map(name => `${name}: 1`).join(", ")} }`;
const objectType = (index: number) => `{ ${shapeProperties(index).map(name => `${name}: number`).join("; ")} }`;
const importBarrels = (barrels: string[]) => barrels.map(name => `import * as ${name} from "./${name}";\n`).join("") + useAllFunction(barrels.map(name => `${name}.useAll()`), unknownArray);

export const builtinModules = [
  "assert", "async_hooks", "buffer", "child_process", "crypto", "dgram", "diagnostics_channel", "dns", "events", "fs", "fs/promises",
  "http", "http2", "https", "module", "net", "os", "path", "perf_hooks", "querystring", "readline", "stream", "stream/promises",
  "string_decoder", "timers", "timers/promises", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
];

export const kinds: Kind[] = [
  declarationKind({ name: "functions", typed: true, declaration: i => `export function f${i}(a: number): number { return a + ${i}; }`, use: i => `f${i}(1)` }),
  declarationKind({ name: "untyped functions", typed: false, declaration: i => `export function f${i}(a) { return a + ${i}; }`, use: i => `f${i}(1)` }),
  declarationKind({ name: "closures", typed: true, declaration: i => `export function outer${i}(x: number): () => number { return () => x + ${i}; }`, use: i => `outer${i}(1)()` }),
  declarationKind({ name: "async functions", typed: true, header: `const resolved = Promise.resolve(1);\n`, declaration: i => `export async function a${i}(x: Promise<number>): Promise<number> { return (await x) + ${i}; }`, use: i => `a${i}(resolved)` }),
  declarationKind({ name: "generators", typed: true, declaration: i => `export function* g${i}(x: number): Generator<number> { yield x + ${i}; }`, use: i => `g${i}(1).next().value` }),
  declarationKind({ name: "try blocks", typed: false, header: `function fails() { throw new Error("no"); }\n`, declaration: i => `export function t${i}(f) { try { return f(); } catch (error) { return ${i}; } }`, use: i => `t${i}(fails)` }),
  declarationKind({ name: "string switches", typed: true, declaration: i => `export function w${i}(s: string): number { switch (s) { case "a${i}": return 1; case "b${i}": return 2; case "c${i}": return 3; default: return 0; } }`, use: i => `w${i}("b${i}")` }),
  declarationKind({ name: "classes", typed: true, isSlowToCompile: true, declaration: i => `export class C${i} { value = ${i}; get(): number { return this.value; } }`, use: i => `new C${i}().get()` }),
  declarationKind({ name: "untyped classes", typed: false, isSlowToCompile: true, declaration: i => `export class C${i} { value = ${i}; get() { return this.value; } }`, use: i => `new C${i}().get()` }),
  declarationKind({ name: "subclasses", typed: true, isSlowToCompile: true, header: `export class Base { value = 0; get(): number { return this.value; } }\n`, declaration: i => `export class C${i} extends Base { more = ${i}; get(): number { return this.more; } }`, use: i => `new C${i}().get()` }),
  declarationKind({ name: "accessors", typed: true, isSlowToCompile: true, declaration: i => `export class G${i} { get value(): number { return ${i}; } set value(next: number) {} }`, use: i => `new G${i}().value` }),
  declarationKind({ name: "static fields", typed: true, isSlowToCompile: true, declaration: i => `export class S${i} { static count = ${i}; }`, use: i => `S${i}.count` }),
  declarationKind({ name: "private fields", typed: true, isSlowToCompile: true, declaration: i => `export class P${i} { #value = ${i}; get(): number { return this.#value; } }`, use: i => `new P${i}().get()` }),
  declarationKind({ name: "interfaces", typed: true, declaration: i => `export interface R${i} ${objectType(i)}\nexport function make${i}(): R${i} { return ${objectLiteral(i)}; }`, use: i => `make${i}()` }),
  declarationKind({ name: "casts", typed: true, declaration: i => `export interface R${i} ${objectType(i)}\nexport function cast${i}(value: unknown): R${i} { return value as R${i}; }`, use: i => `cast${i}(${objectLiteral(i)})` }),
  declarationKind({ name: "enums", typed: true, largeCount: 10_000, declaration: i => `export enum E${i} { First = ${i}, Second }`, use: i => `E${i}[E${i}.Second]` }),
  declarationKind({ name: "variables", typed: true, splitIntoModules: true, declaration: i => `export let v${i} = ${i};`, use: i => `v${i}` }),
  declarationKind({ name: "symbols", typed: true, splitIntoModules: true, declaration: i => `export const s${i} = Symbol("s${i}");`, use: i => `s${i}.description` }),
  expressionKind({ name: "object literals", typed: false, expression: objectLiteral }),
  expressionKind({ name: "typed object literals", typed: true, expression: objectLiteral }),
  expressionKind({ name: "nested object literals", typed: false, expression: i => shapeProperties(i).reduceRight((inner, name) => `{ ${name}: ${inner} }`, "1") }),
  expressionKind({ name: "object literal getters", typed: false, expression: i => `{ get value() { return ${i}; } }.value` }),
  expressionKind({ name: "object literal methods", typed: false, expression: i => `{ method() { return ${i}; } }.method()` }),
  expressionKind({ name: "object spreads", typed: false, parameter: "o", argument: "{ first: 1, second: 2 }", expression: i => `{ ...o, ${shapeProperties(i)[0]}: ${i % 7} }` }),
  expressionKind({ name: "strings", typed: true, expression: i => `"text number ${i}"` }),
  expressionKind({ name: "property names", typed: false, parameter: "o", argument: "{}", expression: i => `o.name${i}` }),
  expressionKind({ name: "property reads", typed: false, parameter: "o", argument: "{ name: 1 }", expression: () => `o.name` }),
  expressionKind({ name: "property writes", typed: false, parameter: "o", argument: "{ name: 0 }", expression: i => `(o.name = ${i % 7})` }),
  expressionKind({ name: "calls", typed: false, parameter: "f", argument: "x => x", expression: i => `f(${i % 7})` }),
  expressionKind({ name: "method calls", typed: false, parameter: "o", argument: "{ method(x) { return x; } }", expression: i => `o.method(${i % 7})` }),
  expressionKind({ name: "regular expressions", typed: true, expression: i => `/x${i}y+/.test("x${i}yy")` }),
  expressionKind({ name: "bigints", typed: true, expression: i => `${i + 1}000000000000000000001n` }),
  expressionKind({ name: "numbers", typed: true, expression: i => `${i}.25` }),
  expressionKind({ name: "array literals", typed: true, expression: i => `[${i}, ${i + 1}, ${i + 2}]` }),
  expressionKind({ name: "tagged templates", typed: false, parameter: "tag", argument: "strings => strings.length", expression: i => "tag`text ${" + i + "} more`" }),
  expressionKind({ name: "dynamic imports", typed: true, expression: () => `import("./imported")`, extraFiles: { "imported.ts": `export const one = 1;\n` } }),
  moduleKind({
    name: "ES modules",
    extension: "ts",
    source: i => `export function f${i}(): number { return ${i}; }\n`,
    barrel: members => members.map(i => `import { f${i} } from "./m${i}";\n`).join("") + useAllFunction(members.map(i => `f${i}()`), unknownArray),
    index: importBarrels,
  }),
  moduleKind({
    name: "CommonJS modules",
    extension: "cjs",
    source: i => `exports.f = function () { return ${i}; };\n`,
    barrel: members => `exports.useAll = function () {\n  return [${members.map(i => `require("./m${i}.cjs").f()`).join(", ")}];\n};\n`,
    index: barrels => `exports.useAll = function () {\n  return [${barrels.map(name => `require("./${name}.cjs").useAll()`).join(", ")}];\n};\n`,
  }),
  moduleKind({
    name: "JSON modules",
    extension: "json",
    barrelExtension: "ts",
    source: i => `{ "value": ${i} }\n`,
    barrel: members => members.map(i => `import m${i} from "./m${i}.json";\n`).join("") + useAllFunction(members.map(i => `m${i}.value`), unknownArray),
    index: importBarrels,
  }),
  moduleKind({
    name: "embedded files",
    extension: "txt",
    barrelExtension: "ts",
    source: i => `file ${i}\n`,
    barrel: members => members.map(i => `import m${i} from "./m${i}.txt" with { type: "file" };\n`).join("") + useAllFunction(members.map(i => `m${i}`), unknownArray),
    index: importBarrels,
  }),
  {
    name: "built-in modules",
    maxCount: builtinModules.length,
    files: (folder, _, count) => ({ [`${folder}/index.ts`]: useAllFunction(builtinModules.slice(0, count).map(name => `import("node:${name}")`), unknownArray) }),
  },
];

export const folderName = (kind: Kind) => kind.name.replaceAll(" ", "-");
const indexSpecifier = (folder: string, files: Files) => `./${folder}/index${`${folder}/index.cjs` in files ? ".cjs" : ""}`;

const workerCount = 4;

export const scenarios = ["nothing", "serve", "request", "workers", "terminate", "inspect", "require cache", "require cache keys", "context", "stat", "resolve", "stack", "throw", "collect", "import"] as const;
export const useEverything = "use everything";

export type Unused = { kind: Kind; count: number };

export function generateProgram(used: Kind[], usedCount: number, unused: Unused[]): Files {
  const files: Files = {};
  let cases = "";
  const usedSpecifiers: string[] = [];
  for (const kind of used) {
    const folder = `used/${folderName(kind)}`;
    Object.assign(files, kind.files(folder, 0, Math.min(usedCount, kind.maxCount ?? usedCount)));
    usedSpecifiers.push(indexSpecifier(folder, files));
    cases += `  case "use ${kind.name}":\n    use(import("${usedSpecifiers.at(-1)}")).then(ready);\n    break;\n`;
  }
  const unusedSpecifiers: string[] = [];
  for (const { kind, count } of unused) {
    const folder = `unused/${folderName(kind)}`;
    Object.assign(files, kind.files(folder, usedCount, Math.min(count, kind.maxCount ?? count)));
    unusedSpecifiers.push(indexSpecifier(folder, files));
  }
  const useInTurn = (specifiers: string[]) => specifiers.map(specifier => `      await use(import("${specifier}"));\n`).join("");
  files["imported.ts"] = `export const one = 1;\n`;
  files["worker.ts"] = `const scope = globalThis as any;\nscope.onmessage = () => {};\nscope.postMessage("ready");\n`;
  files["main.ts"] = `process.kill(process.pid, 0);
function ready() {
  process.kill(process.pid, "SIGSTOP");
}
function readMissingProperty(value: any) {
  return value.property.another;
}
async function use(imported: Promise<{ useAll(): unknown[] }>) {
  return Promise.all((await imported).useAll().flat());
}
switch (process.argv[2]) {
  case "nothing":
    ready();
    break;
  case "serve":
    Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    ready();
    break;
  case "request":
    fetch(Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") }).url).then(ready);
    break;
  case "workers":
    (async () => {
      for (let started = 0; started < ${workerCount}; started++) await new Promise(resolve => (new Worker("./worker.ts").onmessage = resolve));
      ready();
    })();
    break;
  case "terminate":
    (async () => {
      const worker = new Worker("./worker.ts");
      await new Promise(resolve => (worker.onmessage = resolve));
      const closed = new Promise(resolve => worker.addEventListener("close", resolve));
      worker.terminate();
      await closed;
      ready();
    })();
    break;
  case "inspect":
    if (!Bun.inspect({ one: 1, two: [2], three: new Map([[3, "three"]]) })) console.log("nothing");
    ready();
    break;
  case "require cache":
    if (require.cache["/missing"]) console.log("found");
    ready();
    break;
  case "require cache keys":
    if (Object.keys(require.cache).length > 1_000_000) console.log("many");
    ready();
    break;
  case "context":
    require("node:vm").createContext({});
    ready();
    break;
  case "stat":
    require("node:fs").statSync("/");
    ready();
    break;
  case "resolve":
    Bun.resolveSync("./imported.ts", import.meta.dir);
    ready();
    break;
  case "stack":
    if (!new Error("one").stack) console.log("no stack");
    ready();
    break;
  case "throw":
    try {
      readMissingProperty({});
    } catch {
      ready();
    }
    break;
  case "collect":
    Bun.gc(true);
    ready();
    break;
  case "import":
    import("./imported").then(ready);
    break;
  case "${useEverything}":
    (async () => {
${useInTurn(usedSpecifiers)}      ready();
    })();
    break;
  case "use the unused code":
    (async () => {
${useInTurn(unusedSpecifiers)}      ready();
    })();
    break;
${cases}}
`;
  return files;
}
