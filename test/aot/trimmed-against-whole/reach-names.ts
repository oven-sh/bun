import { builtinFeatureUses } from "bun:internal-for-testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Program } from "./compare";

export type Reflected = [root: string, path: string[], type: string];

export function reflect(bun: string): Reflected[] {
  const folder = mkdtempSync(join(tmpdir(), "reach-names-"));
  const env = { ...process.env, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", DO_NOT_TRACK: "1" };
  try {
    const executable = join(folder, process.platform === "win32" ? "reflection.exe" : "reflection");
    const built = Bun.spawnSync({ cmd: [bun, "build", "--compile", "--aot", join(import.meta.dir, "reflection.cjs"), "--outfile", executable], cwd: folder, env, stdout: "pipe", stderr: "pipe" });
    if (built.exitCode !== 0) throw new Error(`reflection.cjs does not compile: ${built.stderr}`);
    const ran = Bun.spawnSync({ cmd: [executable], cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    if (ran.exitCode !== 0) throw new Error(`reflection.cjs exits with ${ran.exitCode}: ${ran.stderr}`);
    return JSON.parse(ran.stdout.toString());
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

class Random {
  state: number;

  constructor(seed: string) {
    this.state = Number(BigInt(Bun.hash(seed)) & 0xffff_ffffn) | 1;
  }

  next(): number {
    let state = this.state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.state = state >>>= 0;
    return state / 0x1_0000_0000;
  }

  below(limit: number): number {
    return Math.floor(this.next() * limit);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.below(items.length)];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

interface Context {
  random: Random;
  isSloppy: boolean;
  isModule: boolean;
  isPlain?: boolean;
  args: string[];
  env: Record<string, string>;
}

const reservedWords = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield arguments eval".split(
    " ",
  ),
);
const isName = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
const isIdentifier = (name: string) => isName(name) && !reservedWords.has(name);

type Key = (name: string, context: Context) => string | undefined;

const constantKeys: Key[] = [name => JSON.stringify(name), name => `\`${name.replace(/[`\\$]/g, "\\$&")}\``];

const computedKeys: Key[] = [
  (name, { random }) => {
    const at = random.below(name.length + 1);
    return `(${JSON.stringify(name.slice(0, at))} + ${JSON.stringify(name.slice(at))})`;
  },
  (name, { random }) => {
    const at = random.below(name.length + 1);
    return `[${JSON.stringify(name.slice(0, at))}, ${JSON.stringify(name.slice(at))}].join("")`;
  },
  name => `${JSON.stringify([...name].reverse().join(""))}.split("").reverse().join("")`,
  name => `String.fromCharCode(${[...name].map(character => character.charCodeAt(0)).join(", ")})`,
  name => `JSON.parse(${JSON.stringify(JSON.stringify({ key: name }))}).key`,
  name => (/^[\x00-\x7f]*$/.test(name) ? `atob(${JSON.stringify(btoa(name))})` : undefined),
  (name, { args }) => `process.argv[${args.push(name) + 1}]`,
  (name, { env }) => {
    const variable = `REACHED_NAME_${Object.keys(env).length}`;
    env[variable] = name;
    return `process.env.${variable}`;
  },
  name => `({ toString() { return ${JSON.stringify(name)}; } })`,
  name => `[${JSON.stringify(name)}]`,
];

function firstDefined<T>(draw: () => T | undefined): T {
  for (;;) {
    const drawn = draw();
    if (drawn !== undefined) return drawn;
  }
}

const keyOf = (name: string, context: Context, isComputed: boolean) => firstDefined(() => context.random.pick(isComputed ? computedKeys : constantKeys)(name, context));

type Road = (parent: string, name: string, context: Context) => string | undefined;

const constantRoads: Road[] = [
  (parent, name) => (isName(name) ? `${parent}.${name}` : undefined),
  (parent, name) => (isName(name) ? `${parent}.${name}` : undefined),
  (parent, name) => (isName(name) ? `${parent}?.${name}` : undefined),
  (parent, name, context) => `${parent}[${keyOf(name, context, false)}]`,
  (parent, name) => `(({ ${JSON.stringify(name)}: value }) => value)(${parent})`,
  (parent, name, context) => `Reflect.get(${parent}, ${keyOf(name, context, false)})`,
];

const fromDescriptor = `found && ("value" in found ? found.value : found.get.call(parent))`;

const computedRoads: Road[] = [
  (parent, name, context) => `${parent}[${keyOf(name, context, true)}]`,
  (parent, name, context) => `${parent}[${keyOf(name, context, true)}]`,
  (parent, name, context) => `${parent}?.[${keyOf(name, context, true)}]`,
  (parent, name, context) => `Reflect.get(${parent}, ${keyOf(name, context, true)})`,
  (parent, name, context) => `(({ [${keyOf(name, context, true)}]: value }) => value)(${parent})`,
  (parent, name, context) => `((parent, key) => { const found = Object.getOwnPropertyDescriptor(parent, key); return ${fromDescriptor}; })(${parent}, ${keyOf(name, context, true)})`,
  (parent, name, context) => `((parent, key) => { const found = Reflect.getOwnPropertyDescriptor(parent, key); return ${fromDescriptor}; })(${parent}, ${keyOf(name, context, true)})`,
  (parent, name, context) => `((parent, key) => { const found = Object.getOwnPropertyDescriptors(parent)[key]; return ${fromDescriptor}; })(${parent}, ${keyOf(name, context, true)})`,
  (parent, name, context) => `((parent, wanted) => { for (const key of Object.getOwnPropertyNames(parent)) if (key === wanted) return parent[key]; })(${parent}, String(${keyOf(name, context, true)}))`,
  (parent, name, context) => `((parent, wanted) => { for (const key of Reflect.ownKeys(parent)) if (key === wanted) return parent[key]; })(${parent}, String(${keyOf(name, context, true)}))`,
  (parent, name, context) => `((parent, wanted) => { for (const key in parent) if (key === wanted) return parent[key]; })(${parent}, String(${keyOf(name, context, true)}))`,
  (parent, name, context) => `((parent, wanted) => { for (const [key, value] of Object.entries(parent)) if (key === wanted) return value; })(${parent}, String(${keyOf(name, context, true)}))`,
  (parent, name, context) => `new Proxy(${parent}, {})[${keyOf(name, context, true)}]`,
  (parent, name, context) => `Object.create(${parent})[${keyOf(name, context, true)}]`,
  (parent, name, context) => `({ ...${parent} })[${keyOf(name, context, true)}]`,
  (parent, name, context) => `Object.assign({}, ${parent})[${keyOf(name, context, true)}]`,
  (parent, name, context) => `({ __proto__: ${parent} })[${keyOf(name, context, true)}]`,
  (parent, name, context) => `[${parent}][0][${keyOf(name, context, true)}]`,
  (parent, name, context) => `((parent) => () => parent)(${parent})()[${keyOf(name, context, true)}]`,
  (parent, name, context) => `((parent, key) => parent[key])(${parent}, ${keyOf(name, context, true)})`,
  (parent, name, context) => `(await Promise.resolve(${parent}))[${keyOf(name, context, true)}]`,
  (parent, name, context) => `new Map([[1, ${parent}]]).get(1)[${keyOf(name, context, true)}]`,
  (parent, name, context) => `(function* (parent) { yield parent; })(${parent}).next().value[${keyOf(name, context, true)}]`,
  (parent, name, context) => `Object(${parent})[${keyOf(name, context, true)}]`,
  (parent, name, context) => `({ __proto__: ${parent}, read(key) { return super[key]; } }).read(${keyOf(name, context, true)})`,
  (parent, name, context) => `((parent, wanted) => Object.values(parent)[Object.keys(parent).indexOf(wanted)])(${parent}, String(${keyOf(name, context, true)}))`,
  (parent, name, context) => `Object.fromEntries(Object.entries(${parent}))[${keyOf(name, context, true)}]`,
  (parent, name) => (isName(name) ? `((parent) => new Proxy({}, { get(_, key) { return parent[key]; } }))(${parent}).${name}` : undefined),
  (parent, name) => (isName(name) ? `((parent) => new Proxy({}, { get(_, key) { return Reflect.get(parent, key); } }))(${parent}).${name}` : undefined),
];

const reached = (parent: string, name: string, context: Context, isComputed: boolean) =>
  firstDefined(() => context.random.pick(isComputed ? computedRoads : context.isPlain ? constantRoads.slice(0, 4) : constantRoads)(parent, name, context));

function globalObject(context: Context, isComputed: boolean): string {
  const plain = context.isPlain ? ["globalThis"] : ["globalThis", "globalThis", "global", "self", "globalThis.globalThis"];
  const indirect = ["[globalThis][0]", "(() => globalThis)()", `(0, eval)("this")`, `Function("return this")()`, `new Function("return globalThis")()`, `Reflect.get(globalThis, "globalThis")`];
  if (context.isSloppy) indirect.push("(function () { return this; })()");
  return context.random.pick(isComputed ? indirect : plain);
}

function moduleObject(name: string, context: Context, isComputed: boolean): string {
  const { random, isModule } = context;
  if (!isComputed) {
    const constant = JSON.stringify(name);
    const everywhere = [`(await import(${constant}))`, `process.getBuiltinModule(${constant})`];
    return random.pick(isModule ? [...everywhere, `import.meta.require(${constant})`] : [...everywhere, `require(${constant})`, `require(${constant})`, `module.require(${constant})`]);
  }
  const key = `String(${keyOf(name, context, true)})`;
  const everywhere = [`(await import(${key}))`, `process.getBuiltinModule(${key})`];
  return random.pick(
    isModule
      ? [...everywhere, `import.meta.require(${key})`, `(await import("node:module")).createRequire(import.meta.url)(${key})`]
      : [...everywhere, `require(${key})`, `module.require(${key})`, `require("node:module").createRequire(__filename)(${key})`, `require("node:module")._load(${key})`, `(0, require)(${key})`],
  );
}

const harmlessArguments = ["", "", "undefined", "0", `""`, `"a"`, "{}", "[]", "null", "1, 2", `"a", "b"`, "function () {}", "new Uint8Array(4)", "{}, {}", `"a", {}`, "true", "-1", "1n", "Symbol.iterator"];

const neverCalled =
  /^(exit|reallyExit|abort|kill|_kill|_debugProcess|_debugEnd|_rawDebug|dlopen|chdir|umask|setuid|seteuid|setgid|setegid|setgroups|initgroups|setPriority|openInEditor|spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|openStdin|prompt|alert|confirm|sleepSync|sleep|wait|waitAsync|pause|waitForDebugger|segfault|crash|panic|raise|\$|chroot|execve|loadEnvFile|setInterval|start|open|close|closeSync|fsyncSync|fdatasyncSync|ftruncateSync|setTimeZone|setRandomSeed|writeHeapSnapshot|generateHeapSnapshot|getHeapSnapshot|takeHeapSnapshot|profile|startSamplingProfiler|startRemoteDebugger|Worker|Terminal|WebView)$/;
const neverCalledIn = /^(node:)?(child_process|cluster|worker_threads)$/;
const calledWithoutArguments = /^(node:)?(dns|dns\/promises|net|tls|http|https|http2|dgram|undici|ws|child_process|cluster|inspector|inspector\/promises|worker_threads|readline|readline\/promises|wasi)$/;
const reachesOutside = /^(fetch|WebSocket|EventSource|connect|listen|udpSocket|serve|dns|S3Client|s3|sql|SQL|postgres|redis|RedisClient|WebView|Worker|BroadcastChannel|Terminal|cron)$/;

function probe([root, path, type]: Reflected, context: Context): string {
  const { random, isPlain } = context;
  // docs/bundler/aot-size.mdx: a member of `Bun` counts as used where the code names it on `Bun`. Behind a computed key it is removed, and a call of it throws.
  const firstThatMayBeComputed = root === "bun" ? 2 : root === "globalThis" && path[0] === "Bun" ? 3 : 0;
  const drawn = !isPlain && random.chance(0.5) ? random.below(path.length + 1) : -1;
  const computedAt = drawn < firstThatMayBeComputed ? -1 : drawn;
  let parent: string;
  let rest = path;
  if (root !== "globalThis") parent = moduleObject(root, context, computedAt === 0);
  else if (computedAt > 1 || (computedAt < 0 && path.length > 1 && isIdentifier(path[0]) && random.chance(0.7))) {
    parent = isIdentifier(path[0]) ? path[0] : `globalThis[${JSON.stringify(path[0])}]`;
    rest = path.slice(1);
  } else parent = globalObject(context, computedAt === 0);
  const skipped = path.length - rest.length;
  for (const [index, name] of rest.slice(0, -1).entries()) parent = reached(parent, name, context, computedAt === index + skipped + 1);
  const last = rest[rest.length - 1];
  const isLastComputed = computedAt === path.length;
  const value = (holder: string) => reached(holder, last, context, isLastComputed);
  const key = () => keyOf(last, context, isLastComputed);

  const operations: (() => string)[] = [
    () => `typeof ${value(parent)}`,
    () => `told(${value(parent)})`,
    () => `told(${value(parent)})`,
    () => `${key()} in ${parent}`,
    () => `Object.hasOwn(${parent}, ${key()})`,
    () => `Object.prototype.hasOwnProperty.call(${parent}, ${key()})`,
    () => `Reflect.has(${parent}, ${key()})`,
    () => `Object.getOwnPropertyNames(${parent}).includes(String(${key()}))`,
    () => `Object.keys(${parent}).includes(String(${key()}))`,
    () => `JSON.stringify(Object.getOwnPropertyDescriptor(${parent}, ${key()}), (_, member) => (typeof member === "function" ? "function" : member))`,
  ];
  if (root === "globalThis" && path.length === 1 && isIdentifier(last) && !isLastComputed) operations.push(() => `typeof ${last}`, () => `told(${last})`);
  if (type === "object" || type === "function") {
    operations.push(
      () => `Object.getOwnPropertyNames(${value(parent)}).sort().join()`,
      () => `Object.keys(${value(parent)}).join()`,
      () => `Reflect.ownKeys(${value(parent)}).length`,
      () => `told(Object.getPrototypeOf(${value(parent)}))`,
    );
  }
  if (type === "function" && !neverCalledIn.test(root) && !path.some(name => neverCalled.test(name))) {
    const given = () => (calledWithoutArguments.test(root) || path.some(name => reachesOutside.test(name)) ? "" : random.pick(harmlessArguments));
    const calls = [
      () => `await settled((async (holder) => Reflect.apply(${value("holder")}, holder, [${given()}]))(${parent}))`,
      () => `await settled((0, ${value(parent)})(${given()}))`,
      () => `await settled(((Made) => new Made(${given()}))(${value(parent)}))`,
      () => `await settled(Reflect.construct(${value(parent)}, [${given()}]))`,
      () => (!isLastComputed && isName(last) ? `await settled(${parent}.${last}(${given()}))` : `await settled(${parent}[${key()}](${given()}))`),
    ];
    if (path.at(-2) === "prototype") {
      const onAnInstance = () => `await settled((async (holder) => Reflect.apply(${value("holder")}, holder, [${given()}]))(made(${parent}.constructor)))`;
      calls.push(onAnInstance, onAnInstance, onAnInstance, onAnInstance);
    }
    if (isPlain) return random.pick(calls)();
    operations.push(...calls, ...calls, ...calls);
  }
  return random.pick(isPlain ? operations.slice(1, 3) : operations)();
}

const helpers = `
function told(value) {
  const type = typeof value;
  if (type === "function") return "function " + value.name + " " + value.length;
  if (type === "object") return value === null ? "null" : Object.prototype.toString.call(value);
  if (type === "string") return JSON.stringify(value.length > 200 ? value.slice(0, 200) : value);
  return type + " " + String(value);
}
function toldError(error) {
  return error instanceof Error ? error.name + ": " + error.message : told(error);
}
function made(Class) {
  for (const given of [[], ["a"], [1], [{}], [new ArrayBuffer(8)], ["http://localhost/"], [function () {}]]) {
    try {
      return Reflect.construct(Class, given);
    } catch {}
  }
  try {
    return Object(Class(1));
  } catch {}
  return Class.prototype;
}
async function settled(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || typeof value.then !== "function") return told(value);
  return Promise.race([value.then(result => "resolves " + told(result), error => "rejects " + toldError(error)), new Promise(resolve => setTimeout(resolve, 300, "pending"))]);
}
`;

function programOf(name: string, probes: string[], { isModule, isSloppy, args, env }: Context, corpus = "names"): Program {
  const lines = probes.map((text, index) => `  try { console.log(${index}, ${text}); } catch (error) { console.log(${index}, "throws", toldError(error)); }`);
  const entry = isModule ? "program.mjs" : "program.cjs";
  const text = `${isModule || isSloppy ? "" : `"use strict";\n`}${helpers}(async () => {\n${lines.join("\n")}\n})().then(() => process.exit(0));\n`;
  const context = { isModule, isSloppy, args, env } as Context;
  return {
    corpus,
    name,
    entry,
    files: () => ({ [entry]: text }),
    args,
    env,
    smaller: probes.length < 2 ? undefined : () => probes.map((_, left) => programOf(name, probes.toSpliced(left, 1), context, corpus)),
  };
}

export function programsThatReachNames(reflected: Reflected[], seed: string, count: number): Program[] {
  const declared = new Set(builtinFeatureUses().filter(({ kind }) => kind !== "NativeBinding" && kind !== "InternalModule").map(({ path }) => path));
  const declaredPrefixLength = (path: string[]) => path.findIndex((_, index) => declared.has(path.slice(0, index + 1).join("."))) + 1;
  const isDeclared = ([root, path]: Reflected) => (root === "globalThis" ? declaredPrefixLength(path) > 0 : declared.has(root) || declared.has(`node:${root}`));
  const byRoot = [...Map.groupBy(reflected, ([root, path]) => (root === "globalThis" ? path[0] : root)).values()];
  const byDeclaredBuiltin = [...Map.groupBy(reflected.filter(isDeclared), ([root, path]) => (root === "globalThis" ? path.slice(0, declaredPrefixLength(path)).join(" ") : root)).values()];
  return Array.from({ length: count }, (_, index) => {
    const random = new Random(`${seed} ${index}`);
    const isModule = random.chance(0.3);
    const context: Context = { random, isModule, isSloppy: !isModule && random.chance(0.5), args: [], env: {} };
    const probes = Array.from({ length: 1 + random.below(4) }, () => probe(random.pick(random.pick(random.chance(0.6) ? byDeclaredBuiltin : byRoot)), context));
    return programOf(`${seed}-${index}`, probes, context);
  });
}

export function programsThatNameEverything(reflected: Reflected[]): Program[] {
  const namespaces = ["Bun", "process", "console"];
  const together = Map.groupBy(reflected, ([root, path]) => (root !== "globalThis" ? root : namespaces.includes(path[0]) ? path.slice(0, 2).join(".") : path[0]));
  const programs: Program[] = [];
  for (const [group, members] of together) {
    for (let first = 0; first < members.length; first += 6) {
      const name = `${group} ${first}`;
      const random = new Random(name);
      const context: Context = { random, isModule: random.chance(0.3), isSloppy: false, isPlain: true, args: [], env: {} };
      programs.push(programOf(name, members.slice(first, first + 6).map(one => probe(one, context)), context, "every-name"));
    }
  }
  return programs;
}
