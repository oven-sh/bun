import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "../aot/harness/run";
import { BundlerTestInput, itBundled } from "./expectBundled";

const usesImage = (stdout: string) =>
  ({
    env: { BUN_AOT_VERBOSE: "1" },
    validate({ stdout: actual, stderr }) {
      expect(actual).toBe(stdout);
      expect(stderr).toMatch(/\[aot\] image: \d+ bytes, \d+ of code at 0x[0-9a-f]+/);
      expect(stderr).toContain("[aot] module: ");
    },
  }) satisfies BundlerTestInput["run"];

describe("bundler", () => {
  for (const [backend, splitting] of [
    ["cli", false],
    ["api", true],
  ] as const) {
    itBundled(`compile/aot/${backend}/Modules${splitting ? "WithSplitting" : ""}`, {
      backend,
      target: "bun",
      compile: { aot: true },
      splitting,
      files: {
        "/entry.ts": /* js */ `
          import { double } from "./other";
          import { fib } from "./fib.cjs";
          class Point { constructor(public x: number, public y: number) {} add(o: Point) { return new Point(this.x + o.x, this.y + o.y); } }
          function sum(n: number) { let p = new Point(0, 0); for (let i = 0; i < n; i++) p = p.add(new Point(i, 1)); return p; }
          async function later(v: number) { await null; return double(v); }
          function* gen() { yield 1; yield 2; }
          const counter = (() => { let n = 0; return () => ++n; })();
          counter();
          console.log(JSON.stringify(sum(1000)), await later(21), [...gen()].join(), counter());
          console.log([3, 1, 2].sort().map(x => x * 2).join(), "abc".toUpperCase(), new Map([[1, "a"]]).get(1));
          const again = require("./fib.cjs");
          const late = await import("./fib.cjs");
          console.log(fib(20), again.fib === fib, late.default.fib === fib, typeof require);
          const { twice } = await import("./lazy");
          console.log(twice(21));
        `,
        "/other.ts": /* js */ `
          export function double(v: number) { return v * 2; }
        `,
        "/fib.cjs": /* js */ `
          exports.fib = function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); };
        `,
        "/lazy.ts": /* js */ `
          import { double } from "./other";
          export const twice = (n: number) => double(n) + double(0);
        `,
      },
      run: usesImage('{"x":499500,"y":1000} 42 1,2 2\n2,4,6 ABC a\n6765 true true function\n42\n'),
    });
  }

  test.concurrent("compile/aot/BuildDoesNotDisturbTheCaller", async () => {
    using dir = tempDir("compile-aot-caller", {
      "app.ts": `console.log("from the executable");`,
      "build.ts": `
        function work() {
          const literal = { a: 1, get b() { return 2; }, c: [1, 2, 3] };
          class K { x = 1; y = this.x + 1; }
          let s = 0;
          for (let i = 0; i < 100000; i++) s += literal.a + literal.b + literal.c.length + new K().y;
          return s;
        }
        const callsItsOwnFunction = (n: number) =>
          new Function("function $$t(v, m) { return 'called' + m; } return $$t(1, 1); // " + n)() === "called1";
        const before = work();
        const own = callsItsOwnFunction(1);
        const newRealmIsMutable = () => !require("node:vm").runInNewContext("Object.isFrozen(Object.prototype)");
        const mutable = newRealmIsMutable();
        const result = await Bun.build({ entrypoints: ["./app.ts"], compile: { aot: true, outfile: "./app" } });
        const after = new Function("return (" + work.toString() + ")()")();
        Math.max = Math.max;
        console.log(result.success, before === work(), before === after, own, callsItsOwnFunction(2), mutable, newRealmIsMutable());
      `,
    });
    const { stdout, exitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
    expect(stdout).toBe("true true true true true true true\n");
    expect(exitCode).toBe(0);

    const {
      stdout: appStdout,
      stderr: appStderr,
      exitCode: appExitCode,
    } = await runCommand([join(String(dir), "app")], undefined, { ...bunEnv, BUN_AOT_VERBOSE: "1" });
    expect(appStdout).toBe("from the executable\n");
    expect(appStderr).toContain("[aot] image: ");
    expect(appExitCode).toBe(0);
  });
});

test.concurrent("compile.aot: concurrent builds from several threads", async () => {
  const apps = [1, 2];
  using dir = tempDir("compile-aot-at-once", {
    ...Object.fromEntries(
      apps.map(n => [
        `app${n}.ts`,
        `function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); } console.log(${n}, fib(1${n}));`,
      ]),
    ),
    "worker.ts": `
      self.onmessage = async ({ data: n }) => {
        const result = await Bun.build({ entrypoints: [\`./app\${n}.ts\`], compile: { aot: true, outfile: \`./worker\${n}\` } });
        postMessage(result.success);
      };
    `,
    "build.ts": `
      const apps = ${JSON.stringify(apps)};
      const here = apps.map(n => Bun.build({ entrypoints: [\`./app\${n}.ts\`], compile: { aot: true, outfile: \`./main\${n}\` } }).then(r => r.success));
      const inWorkers = apps.map(n => {
        const { promise, resolve } = Promise.withResolvers<boolean>();
        const worker = new Worker("./worker.ts");
        worker.onmessage = e => { resolve(e.data); worker.terminate(); };
        worker.postMessage(n);
        return promise;
      });
      console.log(JSON.stringify(await Promise.all([...here, ...inWorkers])));
    `,
  });
  const { stdout, exitCode } = await runCommand([bunExe(), "build.ts"], String(dir));
  expect(stdout).toBe(JSON.stringify(Array(4).fill(true)) + "\n");
  expect(exitCode).toBe(0);

  const outputs = await Promise.all(
    ["main", "worker"].flatMap(kind =>
      apps.map(async n => {
        const { stdout, stderr } = await runCommand([join(String(dir), kind + n)], undefined, {
          ...bunEnv,
          BUN_AOT_VERBOSE: "1",
        });
        return { stdout: stdout.trim(), usesImage: stderr.includes("[aot] image: ") };
      }),
    ),
  );
  expect(outputs).toEqual(["1 89", "2 144", "1 89", "2 144"].map(stdout => ({ stdout, usesImage: true })));
});

const otherTarget = process.platform === "linux" ? "bun-darwin-x64" : "bun-linux-x64";
const whyNot = "can't cross-compile. It only builds for the platform it runs on";

test.concurrent("--aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross", { "entry.ts": `console.log(1);` });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", `--target=${otherTarget}`, "entry.ts", "--outfile", "out"],
    String(dir),
  );
  expect(stderr).toContain(`--aot ${whyNot}`);
  expect(exitCode).not.toBe(0);
});

test.concurrent("compile.aot rejects cross-compilation and unsupported targets", async () => {
  using dir = tempDir("compile-aot-cross-api", { "entry.ts": `console.log(1);` });
  expect(() =>
    Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      compile: { target: otherTarget, aot: true, outfile: join(String(dir), "out") },
    }),
  ).toThrow(`compile.aot ${whyNot}`);
});

test.concurrent("--format has no effect with --aot", async () => {
  using dir = tempDir("compile-aot-format", { "entry.cjs": `console.log(1);` });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "--format=cjs", "entry.cjs", "--outfile", "out"],
    String(dir),
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await runCommand([join(String(dir), "out")], String(dir))).toMatchObject({ stdout: "1\n", exitCode: 0 });
});

test.concurrent("Bun.ModuleGraph refuses a module that is compiled into the executable", async () => {
  using dir = tempDir("compile-aot-module-graph-refused", {
    "entry.ts": `
      const url = new URL("./app.js", import.meta.url).href;
      console.log((await import(url)).name);
      const error = await new Bun.ModuleGraph().import(url).then(() => undefined, (error: any) => error);
      console.log(error?.code, String(error?.message).split(" (bun compile")[0]);
    `,
    "app.ts": `export const name: string = "app";`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "entry.ts", "app.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
  const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")]);
  expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "app",
      expect.stringMatching(
        /^ERR_MODULE_NOT_FOUND Cannot load '.*app\.ts': it's compiled into this executable, and a compiled module can't be loaded a second time \(for example into a Bun\.ModuleGraph\)\.$/,
      ),
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});

// TODO: compile modules so that each graph gets its own instance. Until then graph.import() of a compiled module rejects.
describe.todo("Bun.ModuleGraph with --aot", () => {
  async function run(entry: string, more = "") {
    using dir = tempDir("compile-aot-module-graph", {
      "entry.ts": `
        declare const tag: string | undefined;
        const url = new URL("./app.js", import.meta.url).href;
        async function main() { ${entry} }
        if (Bun.isMainThread && process.argv[2] === "worker") {
          const worker = new Worker(import.meta.url);
          worker.onmessage = e => { console.log(e.data); worker.terminate(); };
        } else {
          const result = JSON.stringify(await main());
          if (Bun.isMainThread) console.log(result);
          else postMessage(result);
        }
      `,
      "app.ts": `
        declare const tag: string;
        let n = 0;
        export function count() { return ++n; }
        export const viaClosure = () => () => count();
        export function call(f: () => number) { return f() * 100 + count(); }
        export function* each() { while (true) yield count(); }
        export async function later() { await 1; return count(); }
        export function* take(limit: number) { try { for (let i = 0; i < limit; i++) yield count(); return "end"; } finally { count(); } }
        export function* through(inner: Iterable<number>) { yield count(); yield* inner; yield count(); }
        export async function* eachLater() { while (true) yield count(); }
        export function sumOf(values: Iterable<number>) { let sum = 0; for (const value of values) sum += value; return sum * 1000 + count(); }
        export const current = () => n;
        export class Counter { get next() { return count(); } }
        export class Empty {}
        export class Derived extends Empty { field = count(); }
        export function tagInLoop() { let all = ""; for (let i = 0; i < 3; i++) all += tag; return all; }
        export const tagsViaBuiltin = () => [1, 2].map(() => tag).join("");
        export function disposeAndGoOn(graph: { dispose(): void }) {
          graph.dispose();
          Bun.gc(true);
          Bun.gc(true);
          return [count(), [1, 2, 3].map(x => x + n).join()];
        }
        export class Box {
          method() { return n; }
          get accessor() { return n; }
          set accessor(value: number) { n = value; }
        }
        export function makeBox(): Box { return new Box(); }
        export function callMethod(box: Box) { return box.method(); }
        export function readAccessor(box: Box) { return box.accessor; }
        export function writeAccessor(box: Box, value: number) { box.accessor = value; }
        export interface Point { x: number; y: number }
        export function makePoint(x: number, y: number): Point { return { x, y }; }
        export function movePoint(point: Point) { point.x += n; return point.x * 10 + point.y; }
        ${more}
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "--splitting", "entry.ts", "app.ts", "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    const results: { where: string; stdout: string; stderr: string; exitCode: number }[] = [];
    for (const where of ["main", "worker"]) {
      const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out"), where]);
      results.push({ where, stdout: stdout.trim(), stderr, exitCode });
    }
    return results;
  }
  const everywhere = (value: unknown) =>
    ["main", "worker"].map(where => ({ where, stdout: JSON.stringify(value), stderr: "", exitCode: 0 }));
  const membersOfOneGraph = `
        export class Crate { value = 1; method() { return n; } }
        export class SmallCrate extends Crate { small = 2; }
        export function makeCrate(): Crate { return new Crate(); }
        export function makeSmallCrate(): Crate { return new SmallCrate(); }
        export function isCrate(value: unknown) { return value instanceof Crate; }
        export function isSmallCrate(value: Crate | SmallCrate | null) { return value instanceof SmallCrate; }
        export function countCrates(values: unknown[]) { let found = 0; for (let i = 0; i < values.length; i++) if (values[i] instanceof Crate) found++; return found; }
        export function kindOf(value: Crate | Point | string) { return typeof value === "string" ? "string" : value instanceof Crate ? "crate" : "point"; }
        export class Tally { static total = 0; static add() { return ++Tally.total; } }
        export const table = { one: 1 };
        const strings = (parts: TemplateStringsArray) => parts;
        export function template() { return strings\`x\`; }
        export class Failure extends Error { code = 5; }
        export function fail(): never { count(); throw new Failure("failed"); }
        export function isFailure(value: unknown) { return value instanceof Failure; }
        export function catchAndCount(f: () => void) { try { f(); } catch { return count(); } return -1; }
        export function finallyCount(f: () => void) { try { try { f(); } finally { count(); } } catch { count(); } return n; }
        export class Even { static [Symbol.hasInstance](value: number) { return (value + count()) % 2 === 0; } }
        export class Steps { left = 2; [Symbol.iterator]() { return this; } next() { return this.left-- > 0 ? { value: count(), done: false } : { value: undefined, done: true }; } }
        export function replacer() { return String(count()); }
        export function getTrap() { return count(); }
        export function thenable(resolve: (value: number) => void) { resolve(count()); }
        export const handlers = [() => count(), function () { return count(); }];
        export function addExtra(point: any) { point.extra = n; return point.extra + point.x; }
        export function copy(value: object) { return JSON.stringify({ ...value, n }); }
        export async function laterTwice(f: () => Promise<number>) { const first = await f(); return first * 100 + count(); }
        export function argumentsCount() { return arguments.length + count(); }
        export const bound = count.bind(null);
        export function callWith(f: (this: unknown) => number) { return f.call(null) * 100 + count(); }
        export function viaDefault(value = count()) { return value; }
        export const accessor = { get now() { return count(); }, set now(value: number) { n = value; } };
        export class Sealed {
          #secret = 7;
          #text = "mine";
          #method() { return 8; }
          get #accessor() { return 9; }
          set #accessor(value: number) { this.#secret = value; }
          static #shared = 10;
          static read(value: Sealed) { return value.#secret; }
          static readAny(value: any) { return value.#secret; }
          static readText(value: Sealed) { return value.#text; }
          static write(value: Sealed) { value.#secret = 1; return value.#secret; }
          static writeAny(value: any) { value.#secret = 2; return value.#secret; }
          static add(value: Sealed) { value.#secret += 1; return value.#secret; }
          static has(value: Sealed) { return #secret in value; }
          static hasAny(value: object) { return #secret in value; }
          static hasMethod(value: Sealed) { return #method in value; }
          static call(value: Sealed) { return value.#method(); }
          static callAny(value: any) { return value.#method(); }
          static method(value: Sealed) { return typeof value.#method; }
          static get(value: Sealed) { return value.#accessor; }
          static set(value: Sealed) { value.#accessor = 3; return value.#secret; }
          static shared(value: typeof Sealed) { return value.#shared; }
          static sum(values: Sealed[]) { let sum = 0; for (let i = 0; i < values.length; i++) { try { sum += values[i]!.#secret; } catch { sum -= 1; } } return sum; }
          static sumAny(values: any[]) { let sum = 0; for (let i = 0; i < values.length; i++) { try { sum += values[i].#secret; } catch { sum -= 1; } } return sum; }
          static countOwn(values: Sealed[]) { let own = 0; for (let i = 0; i < values.length; i++) if (#secret in values[i]!) own++; return own; }
          own() { return this.#secret; }
          sameAs(other: Sealed) { return this.#secret === other.#secret; }
          static brand(value: Sealed) { try { value.#secret; return true; } catch { return false; } }
          static brandByStore(value: Sealed) { try { value.#text = "mine"; return true; } catch { return false; } }
        }
        export class SealedHeir extends Sealed { #deeper = 11; static deeper(value: SealedHeir) { return value.#deeper; } }
        export function makeSealed() { return new Sealed(); }
        export function makeSealedHeir() { return new SealedHeir(); }
        const key = Symbol("key");
        const action = Symbol("action");
        const shared = Symbol.for("shared");
        export class Keyed { [key]?: number = 3; [shared] = 6; [action]() { return 4; } }
        export function makeKeyed() { return new Keyed(); }
        export function makeMarked() { return { [key]: 5, plain: 1 }; }
        export function keyOf() { return key; }
        export function readKey(value: any) { return value[key]; }
        export function readKeyed(value: Keyed) { return value[key]; }
        export function readShared(value: Keyed) { return value[shared]; }
        export function writeKey(value: any) { value[key] = 12; return Object.getOwnPropertySymbols(value).length; }
        export function hasKey(value: object) { return key in value; }
        export function hasKeyed(value: Keyed) { return key in value; }
        export function act(value: any) { return value[action]?.(); }
        export function sumKeys(values: any[]) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i][key] ?? -1; return sum; }
      `;

  test.concurrent("separate module state per graph", async () => {
    expect(
      await run(`
        const a = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const b = await new Bun.ModuleGraph().import(url);
        return [a.count(), a.count(), a.count(), host.count(), b.count(), b.count(), a.count === b.count, a.count === host.count];
      `),
    ).toEqual(everywhere([1, 2, 3, 1, 1, 2, false, false]));
  });

  test.concurrent(
    "functions of one graph called from another, and from the host, use their own variables",
    async () => {
      expect(
        await run(`
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        a.count();
        return [
          a.call(b.count), b.call(a.count), host.call(a.viaClosure()), a.call(host.count), a.call(() => 7),
          a.each().next().value, await b.later(), new a.Counter().next, [0].map(b.count)[0], Reflect.apply(a.count, null, []),
        ];
      `),
      ).toEqual(everywhere([102, 302, 401, 205, 706, 7, 3, 8, 4, 9]));
    },
  );

  test.concurrent(
    "generators of one graph stepped from another, and from the host, use their own variables",
    async () => {
      expect(
        await run(`
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const state = () => [a.current(), b.current(), host.current()].join("/");
        const out: unknown[] = [];
        const ofA = a.each();
        out.push(ofA.next().value, ofA.next().value, state());
        let sum = 0;
        for (const value of b.take(3)) sum += value;
        out.push(sum, state());
        out.push([...a.take(2)].join(), state());
        const [first, second] = b.take(5);
        out.push(first, second, state());
        out.push(Array.from(host.take(2)).join(), state());
        out.push([...a.through(b.take(2))].join(), state());
        out.push(a.sumOf(b.take(2)), host.sumOf(a.take(1)), state());
        const stopped = a.take(9);
        out.push(stopped.next().value, JSON.stringify(stopped.return(5)), JSON.stringify(stopped.next()), state());
        const thrown = b.take(9);
        thrown.next();
        try { thrown.throw(new Error("out")); } catch (error) { out.push((error as Error).message); }
        out.push(state());
        const later = a.eachLater();
        out.push((await later.next()).value, (await later.next()).value, state());
        let seen = 0;
        for await (const value of b.eachLater()) { seen += value; if (value > 20 || ++sum > 8) break; }
        out.push(seen, state());
        const own = host.each();
        out.push(own.next().value, ofA.next().value, own.next().value, state());
        out.push(new Map([[1, 2]]).entries().next().value!.join(), JSON.stringify(ofA.next()), Object.getPrototypeOf(ofA.next()) === Object.prototype);
        return out;
      `),
      ).toEqual(
        everywhere([
          1,
          2,
          "2/0/0",
          6,
          "2/4/0",
          "3,4",
          "5/4/0",
          5,
          6,
          "5/7/0",
          "1,2",
          "5/7/3",
          "6,8,9,7",
          "7/10/3",
          23008,
          9004,
          "10/13/4",
          11,
          '{"value":5,"done":true}',
          '{"done":true}',
          "12/13/4",
          "out",
          "12/15/4",
          13,
          14,
          "14/15/4",
          51,
          "14/18/4",
          5,
          15,
          6,
          "15/18/6",
          "1,2",
          '{"value":16,"done":false}',
          true,
        ]),
      );
    },
  );

  const stateOfOneGraph = `
        import * as fs from "node:fs";
        import { EventEmitter } from "node:events";
        export const fileSystem = fs;
        export const Emitter = EventEmitter;
        export const pattern = /a/g;
        export function advance(text: string) { pattern.test(text); return pattern.lastIndex; }
        export function freshPattern() { return /b/y; }
        export const list = [1, 2, 3];
        export const pair = [1, "one"] as const;
        export const registry = new Map<string, number>();
        export const seen = new WeakSet<object>();
        export function mark(value: object) { const had = seen.has(value); seen.add(value); return had; }
        export enum Color { Red, Green }
        export const enum Shade { Dark = 5 }
        export function shade() { return Shade.Dark; }
        export function Plain(this: any) { this.made = count(); }
        Plain.prototype.tell = function () { return n; };
        export const frozen = Object.freeze({ deep: { value: 1 } });
        export const big = 12345678901234567890n;
        export const text = "shared text";
        export const meta = import.meta;
        export class Lazy { handler = () => count(); static make() { return new Lazy(); } }
        export class WithStatics { static items: number[] = []; static #hidden = 0; static bump() { return ++WithStatics.#hidden; } static { WithStatics.items.push(count()); } }
        export const namespaceLike = { nested: { count } };
        export function* numbers() { yield 1; }
        export async function soon() { return 1; }
        export const arrow = () => n;
        export function defaults({ step = count() }: { step?: number } = {}) { return step; }
        export const date = new Date(0);
        export const buffer = new Uint8Array(2);
        export const error = new Error("made at load");
        export const promise = Promise.resolve(count());
        export let reassigned = 1;
        export function reassign() { reassigned++; return reassigned; }
        export const getters = { get self() { return getters; } };
        export class Node { next: Node | null = null; static root = new Node(); }
        export function once() { return (once as any).cache ??= { made: count() }; }
        export const tagged = ((parts: TemplateStringsArray, ...values: number[]) => parts.raw.join("|") + values.join())\`a\${1}b\`;
        export const symbolDescription = Symbol("described").description;
        export const wellKnown = Symbol.iterator;
      `;

  test.concurrent("what belongs to one graph is not another's", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const state = () => [a.current(), b.current(), host.current()].join("/");
        const out: unknown[] = [];
        const attempt = (f: () => unknown) => { try { return f(); } catch (error) { return (error as Error).constructor.name; } };
        out.push("instanceof", a.isCrate(a.makeCrate()), b.isCrate(a.makeCrate()), host.isCrate(b.makeSmallCrate()), b.isCrate(b.makeSmallCrate()), a.makeCrate() instanceof b.Crate, a.makeCrate() instanceof a.Crate);
        out.push(a.isSmallCrate(a.makeSmallCrate()), a.isSmallCrate(b.makeSmallCrate()), a.countCrates([a.makeCrate(), b.makeCrate(), host.makeCrate(), a.makeSmallCrate(), {}, 1]), a.kindOf(b.makeCrate()), a.kindOf(a.makeCrate()));
        let hot = 0;
        const mixed = [a.makeCrate(), b.makeCrate(), a.makeSmallCrate(), b.makeSmallCrate()];
        for (let i = 0; i < 2000; i++) hot += a.countCrates(mixed);
        out.push(hot);
        out.push("static", a.Tally.add(), a.Tally.add(), b.Tally.add(), host.Tally.total, a.table === b.table, a.template() === a.template());
        out.push("throw", attempt(a.fail), state(), b.catchAndCount(a.fail), state(), host.finallyCount(b.fail), state());
        try { a.fail(); } catch (error) { out.push(a.isFailure(error), b.isFailure(error), error instanceof Error); }
        out.push("classes", new a.Derived().field, (Reflect.construct(b.Derived, []) as any).field, state());
        class Mine extends a.Derived { own = b.count(); }
        const mine: any = new Mine();
        out.push(mine.field, mine.own, mine instanceof a.Empty, mine instanceof b.Empty, state());
        out.push("hasInstance", (1 as any) instanceof a.Even, (1 as any) instanceof a.Even, (1 as any) instanceof b.Even, state());
        out.push("iterate", [...new a.Steps()].join(), Array.from(new b.Steps()).join(), state());
        out.push("callbacks", "xx".replace(/x/g, b.replacer), (new Proxy({}, { get: a.getTrap }) as any).anything, JSON.stringify({ toJSON: b.count }), String({ toString: a.replacer }), +{ valueOf: b.count }, Array.from({ length: 2 }, a.count).join(), state());
        out.push(a.handlers[0](), a.handlers[1](), b.bound(), a.callWith(b.count), b.argumentsCount(1, 2), a.viaDefault(), a.viaDefault(0), state());
        out.push(a.accessor.now, (b.accessor.now = 50), b.accessor.now, (Object.defineProperty({}, "x", { get: a.count }) as any).x, state());
        out.push("jobs", await { then: a.thenable }, await Promise.resolve().then(b.count), (await Promise.all([a.later(), b.later(), host.later()])).join(), await a.laterTwice(b.later), state());
        out.push(await new Promise(resolve => queueMicrotask(() => resolve(a.count()))), await new Promise(resolve => setTimeout(() => resolve(b.count()), 1)), await new Promise(resolve => setTimeout(resolve, 1)).then(a.count), state());
        out.push("objects", b.addExtra(a.makePoint(1, 2)), a.addExtra(a.makePoint(1, 2)), host.addExtra({ x: 1 }), b.copy(a.makeCrate()), a.copy(b.makePoint(3, 4)), a.copy(a.makeSmallCrate()), state());
        return out;
      `,
        membersOfOneGraph,
      ),
    ).toEqual(
      everywhere([
        "instanceof",
        true,
        false,
        false,
        true,
        false,
        true,
        true,
        false,
        2,
        "point",
        "crate",
        4000,
        "static",
        1,
        2,
        1,
        0,
        false,
        true,
        "throw",
        "Failure",
        "1/0/0",
        1,
        "2/1/0",
        2,
        "2/2/2",
        true,
        false,
        true,
        "classes",
        4,
        3,
        "4/3/2",
        5,
        4,
        true,
        false,
        "5/4/2",
        "hasInstance",
        false,
        true,
        true,
        "7/5/2",
        "iterate",
        "8,9",
        "6,7",
        "9/7/2",
        "callbacks",
        "89",
        10,
        "10",
        "11",
        11,
        "12,13",
        "13/11/2",
        14,
        15,
        12,
        1316,
        16,
        17,
        0,
        "17/14/2",
        18,
        50,
        51,
        19,
        "19/51/2",
        "jobs",
        20,
        52,
        "21,53,3",
        5422,
        "22/54/3",
        23,
        55,
        24,
        "24/55/3",
        "objects",
        56,
        25,
        4,
        '{"value":1,"n":55}',
        '{"x":3,"y":4,"n":24}',
        '{"value":1,"small":2,"n":24}',
        "24/55/3",
      ]),
    );
  });

  test.concurrent("private names and symbols of one graph are not another's", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const out: unknown[] = [];
        const attempt = (f: () => unknown) => { try { return f(); } catch (error) { return (error as Error).constructor.name; } };
        for (const [reader, maker] of [[a, a], [a, b], [b, a], [host, a], [a, host]]) {
          const S = reader.Sealed;
          const fresh = () => maker.makeSealed();
          out.push([S.read, S.readAny, S.readText, S.write, S.writeAny, S.add, S.has, S.hasAny, S.hasMethod, S.call, S.callAny, S.method, S.get, S.set].map(f => attempt(() => f(fresh()))).join());
          out.push([attempt(() => S.shared(maker.Sealed)), attempt(() => S.prototype.own.call(fresh())), attempt(() => reader.makeSealed().sameAs(fresh())), attempt(() => S.read(maker.makeSealedHeir())), attempt(() => reader.SealedHeir.deeper(maker.makeSealedHeir())), attempt(() => reader.SealedHeir.deeper(fresh()))].join());
        }
        const sealed = [a.makeSealed(), b.makeSealed(), a.makeSealedHeir(), host.makeSealed(), a.makeSealed()];
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += a.Sealed.sum(sealed) * 10000 + a.Sealed.sumAny(sealed) * 100 + a.Sealed.countOwn(sealed);
        out.push(sum, b.Sealed.sum(sealed), host.Sealed.countOwn(sealed));
        out.push("symbols", a.keyOf() === a.keyOf(), a.keyOf() === b.keyOf());
        for (const [reader, maker] of [[a, a], [a, b], [host, b]]) {
          out.push([reader.readKey(maker.makeKeyed()), reader.readKeyed(maker.makeKeyed()), reader.readShared(maker.makeKeyed()), reader.readKey(maker.makeMarked()), reader.hasKey(maker.makeKeyed()), reader.hasKeyed(maker.makeKeyed()), reader.hasKey(maker.makeMarked()), reader.act(maker.makeKeyed()), reader.writeKey(maker.makeKeyed()), reader.writeKey(maker.makeMarked()), reader.writeKey({})].map(String).join());
        }
        const written = b.makeKeyed();
        a.writeKey(written);
        out.push(a.readKey(written), b.readKey(written), written[a.keyOf()], written[b.keyOf()]);
        const keyed = [a.makeKeyed(), b.makeKeyed(), a.makeMarked(), b.makeMarked(), {}];
        let keys = 0;
        for (let i = 0; i < 1000; i++) keys += a.sumKeys(keyed);
        out.push(keys, b.sumKeys(keyed), host.sumKeys(keyed));
        out.push("brand", a.Sealed.brand(a.makeSealed()), a.Sealed.brand(b.makeSealed()), host.Sealed.brand(a.makeSealed()), a.Sealed.brandByStore(a.makeSealed()), a.Sealed.brandByStore(b.makeSealed()));
        return out;
      `,
        membersOfOneGraph,
      ),
    ).toEqual(
      everywhere([
        "7,7,mine,1,2,8,true,true,true,8,8,function,9,3",
        "10,7,true,7,11,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,false,false,false,TypeError,TypeError,TypeError,TypeError,TypeError",
        "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError",
        191903000,
        3,
        1,
        "symbols",
        true,
        false,
        "3,3,6,5,true,true,true,4,2,1,1",
        "undefined,undefined,6,undefined,false,false,false,undefined,3,2,1",
        "undefined,undefined,6,undefined,false,false,false,undefined,3,2,1",
        12,
        3,
        12,
        3,
        5000,
        5,
        -5,
        "brand",
        true,
        false,
        false,
        true,
        false,
      ]),
    );
  });

  test.concurrent("the state of a module is its graph's own, and what graphs share", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const out: unknown[] = [];
        const same = (name: string) => [a[name] === b[name], a[name] === host[name], a[name] === a[name]].map(Number).join("");
        for (const name of ["fileSystem", "Emitter", "pattern", "list", "pair", "registry", "seen", "Color", "Plain", "frozen", "big", "text", "meta", "Lazy", "WithStatics", "namespaceLike", "numbers", "soon", "arrow", "date", "buffer", "error", "promise", "getters", "Node", "wellKnown", "tagged", "symbolDescription"]) out.push(name + " " + same(name));
        out.push("state", a.advance("aaa"), a.advance("aaa"), b.advance("aaa"), host.pattern.lastIndex, a.freshPattern() === a.freshPattern());
        a.list.push(4); a.registry.set("x", 1); a.buffer[0] = 9; a.date.setTime(5); (a.Color as any).Blue = 2; a.error.message = "changed";
        out.push(a.list.length, b.list.length, a.registry.size, b.registry.size, b.buffer[0], b.date.getTime(), "Blue" in b.Color, b.error.message, a.shade());
        const shared = {};
        out.push(a.mark(shared), a.mark(shared), b.mark(shared), host.mark(shared));
        out.push("functions", new a.Plain().made, new a.Plain().tell(), new b.Plain().tell(), new a.Plain() instanceof b.Plain, new a.Plain() instanceof a.Plain, a.Plain.prototype === b.Plain.prototype, a.numbers.prototype === b.numbers.prototype, Object.getPrototypeOf(a.numbers) === Object.getPrototypeOf(b.numbers));
        out.push(a.Lazy.make().handler(), b.Lazy.make().handler(), a.Lazy.make().handler === a.Lazy.make().handler, a.namespaceLike.nested.count(), a.defaults(), a.defaults({ step: 0 }), b.defaults());
        out.push("statics", a.WithStatics.items.join(), b.WithStatics.items.join(), a.WithStatics.bump(), a.WithStatics.bump(), b.WithStatics.bump(), a.Node.root === b.Node.root, a.Node.root instanceof a.Node, a.Node.root instanceof b.Node);
        out.push("bindings", a.reassign(), a.reassigned, b.reassigned, host.reassign(), host.reassigned, a.getters.self === a.getters, a.getters.self === b.getters);
        out.push(a.once() === a.once(), a.once() === b.once(), a.once().made, b.once().made, await a.promise, await b.promise, await host.promise);
        out.push("meta", a.meta.url === b.meta.url, a.meta.url === url, a.meta.main, b.meta.main, [a.current(), b.current(), host.current()].join("/"));
        return out;
      `,
        stateOfOneGraph,
      ),
    ).toEqual(
      everywhere([
        "fileSystem 001",
        "Emitter 111",
        "pattern 001",
        "list 001",
        "pair 001",
        "registry 001",
        "seen 001",
        "Color 001",
        "Plain 001",
        "frozen 001",
        "big 111",
        "text 111",
        "meta 001",
        "Lazy 001",
        "WithStatics 001",
        "namespaceLike 001",
        "numbers 001",
        "soon 001",
        "arrow 001",
        "date 001",
        "buffer 001",
        "error 001",
        "promise 001",
        "getters 001",
        "Node 001",
        "wellKnown 111",
        "tagged 111",
        "symbolDescription 111",
        "state",
        1,
        2,
        1,
        0,
        false,
        4,
        3,
        1,
        0,
        0,
        0,
        false,
        "made at load",
        5,
        false,
        true,
        false,
        false,
        "functions",
        3,
        4,
        3,
        false,
        true,
        false,
        false,
        true,
        7,
        4,
        false,
        8,
        9,
        0,
        5,
        "statics",
        "1",
        "1",
        1,
        2,
        1,
        false,
        true,
        false,
        "bindings",
        2,
        2,
        1,
        2,
        2,
        true,
        false,
        true,
        false,
        10,
        6,
        2,
        2,
        2,
        "meta",
        true,
        true,
        true,
        true,
        "10/6/2",
      ]),
    );
  });

  test.concurrent("import.meta of a second entry point that the host imports", async () => {
    expect(
      await run(
        `
        const host = await import(url);
        return [host.meta.url === url, host.meta.main, host.meta.file];
      `,
        stateOfOneGraph,
      ),
    ).toEqual(everywhere([true, false, "app.js"]));
  });

  test.concurrent("typed code of one graph works on another graph's objects", async () => {
    expect(
      await run(
        `
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const state = () => [a.current(), b.current(), host.current()].join("/");
        const out: unknown[] = [];
        for (const [user, maker] of [[a, a], [a, b], [b, a], [host, b], [a, host]]) {
          const lazy = maker.Lazy.make(), heir = maker.makeLazyHeir(), runner = maker.makeRunner();
          out.push([user.callHandler(lazy), user.callPlain(lazy), user.callBump(lazy), user.readNow(lazy), user.callBump(heir), user.callDetached(lazy), user.makeAnother(lazy)].join(), state());
          out.push([user.methodOf(lazy) === maker.Lazy.prototype.bump, user.methodOf(lazy) === user.Lazy.prototype.bump, user.handlerOf(lazy) === lazy.handler, user.classOf(lazy) === maker.Lazy, user.methodOf(heir) === maker.LazyHeir.prototype.bump].join());
          out.push([user.callRun(runner), user.callStep(runner), user.readSize(runner), user.runOf(runner) === runner.run, user.runOf(runner)()].join(), state());
          out.push([user.drain(new maker.Walk()), user.drainAny(new maker.Walk()), user.describe(lazy), user.describe(runner), user.toText(lazy), user.keysOf(lazy), user.cloneOf(lazy)].join(), state());
          const pair = new maker.Pair(maker.Lazy.make(), user.Lazy.make());
          out.push([user.bothOf(pair), user.innerOf(pair), user.describe(pair)].join(), state());
        }
        out.push(a.callAll([a.count, b.count, host.count, b.addCount.bind(null, 0)]), a.callEach([a.Lazy.make(), b.Lazy.make(), host.Lazy.make()]), a.handleEach([a.Lazy.make(), b.Lazy.make(), host.Lazy.make()]), state());
        let hot = 0;
        const mixed = [a.Lazy.make(), b.Lazy.make(), a.makeLazyHeir(), b.makeLazyHeir()];
        for (let i = 0; i < 500; i++) hot = (hot + a.callEach(mixed) + a.handleEach(mixed)) % 1000003;
        out.push(hot, state());
        out.push(await a.awaitIt(b.later()), await a.awaitCall(b.later), a.sortBy([1, 3, 2], b.descending), a.mapWith([1, 2], b.addCount), state());
        return out;
      `,
        `
        export class Lazy { handler = () => count(); plain = function () { return count(); }; bump() { return count(); } get now() { return count(); } static make() { return new Lazy(); } }
        export class LazyHeir extends Lazy { override bump() { return super.bump() * 10; } }
        export function makeLazyHeir(): Lazy { return new LazyHeir(); }
        export function callHandler(value: Lazy) { return value.handler(); }
        export function callPlain(value: Lazy) { return value.plain(); }
        export function callBump(value: Lazy) { return value.bump(); }
        export function readNow(value: Lazy) { return value.now; }
        export function methodOf(value: Lazy) { return value.bump; }
        export function handlerOf(value: Lazy) { return value.handler; }
        export function callDetached(value: Lazy) { const bump = value.bump; return bump.call(value); }
        export function classOf(value: Lazy) { return value.constructor; }
        export function makeAnother(value: Lazy) { return new (value.constructor as typeof Lazy)().bump(); }
        export interface Runner { run(): number; step: () => number; readonly size: number }
        export function makeRunner(): Runner { return { run() { return count(); }, step: () => count(), get size() { return count(); } }; }
        export function callRun(value: Runner) { return value.run(); }
        export function callStep(value: Runner) { return value.step(); }
        export function readSize(value: Runner) { return value.size; }
        export function runOf(value: Runner) { return value.run; }
        export function callAll(values: (() => number)[]) { let sum = 0; for (const f of values) sum = sum * 100 + f(); return sum; }
        export function callEach(values: Lazy[]) { let sum = 0; for (let i = 0; i < values.length; i++) sum = sum * 100 + values[i]!.bump(); return sum; }
        export function handleEach(values: Lazy[]) { let sum = 0; for (let i = 0; i < values.length; i++) sum = sum * 100 + values[i]!.handler(); return sum; }
        export class Walk { left = 2; [Symbol.iterator]() { return this; } next(): IteratorResult<number> { return this.left-- > 0 ? { value: count(), done: false } : { value: undefined, done: true }; } }
        export function drain(values: Walk) { let sum = 0; for (const value of values) sum = sum * 100 + value; return sum; }
        export function drainAny(values: Iterable<number>) { let sum = 0; for (const value of values) sum = sum * 100 + value; return sum; }
        export async function awaitIt(value: Promise<number>) { return (await value) * 100 + count(); }
        export async function awaitCall(f: () => Promise<number>) { return (await f()) * 100 + count(); }
        export function sortBy(values: number[], compare: (x: number, y: number) => number) { return values.sort(compare).join(); }
        export const descending = (x: number, y: number) => y - x + 0 * n;
        export function mapWith(values: number[], f: (x: number) => number) { return values.map(f).join(); }
        export const addCount = (x: number) => x + count();
        export class Pair { constructor(public first: Lazy, public second: Lazy) {} both() { return this.first.bump() * 100 + this.second.bump(); } }
        export function bothOf(value: Pair) { return value.both(); }
        export function innerOf(value: Pair) { return value.second.handler(); }
        export function describe(value: Lazy | Runner | Pair) { return value instanceof Lazy ? "lazy" : value instanceof Pair ? "pair" : "runner"; }
        export function toText(value: Lazy) { return String(value) + JSON.stringify(value); }
        export function keysOf(value: Lazy) { return Object.keys(value).join(); }
        export function cloneOf(value: Lazy) { return { ...value }.handler(); }
      `,
      ),
    ).toEqual(
      everywhere([
        "1,2,3,4,50,6,7",
        "7/0/0",
        "true,true,true,true,true",
        "8,9,10,true,11",
        "11/0/0",
        "1213,1415,lazy,runner,[object Object]{},handler,plain,16",
        "16/0/0",
        "1718,19,pair",
        "19/0/0",
        "1,2,3,4,50,6,7",
        "19/7/0",
        "true,false,true,true,true",
        "8,9,10,true,11",
        "19/11/0",
        "1213,1415,runner,runner,[object Object]{},handler,plain,16",
        "19/16/0",
        "1720,21,runner",
        "21/17/0",
        "22,23,24,25,260,27,28",
        "28/17/0",
        "true,false,true,true,true",
        "29,30,31,true,32",
        "32/17/0",
        "3334,3536,runner,runner,[object Object]{},handler,plain,37",
        "37/17/0",
        "3818,19,runner",
        "38/19/0",
        "20,21,22,23,240,25,26",
        "38/26/0",
        "true,false,true,true,true",
        "27,28,29,true,30",
        "38/30/0",
        "3132,3334,runner,runner,[object Object]{},handler,plain,35",
        "38/35/0",
        "3601,2,runner",
        "38/36/2",
        "3,4,5,6,70,8,9",
        "38/36/9",
        "true,false,true,true,true",
        "10,11,12,true,13",
        "38/36/13",
        "1415,1617,runner,runner,[object Object]{},handler,plain,18",
        "38/36/18",
        "1939,40,runner",
        "40/36/19",
        41372038,
        423921,
        434022,
        "43/40/22",
        309072,
        "2043/2040/22",
        206144,
        206245,
        "3,2,1",
        "2044,2046",
        "2045/2044/22",
      ]),
    );
  });

  test.concurrent("closure outlives its graph", async () => {
    expect(
      await run(`
        let graph: Bun.ModuleGraph | null = new Bun.ModuleGraph();
        const { count, viaClosure } = await graph.import(url);
        const closure = viaClosure();
        count();
        graph.dispose();
        graph = null;
        for (let i = 0; i < 3; i++) { Bun.gc(true); await new Bun.ModuleGraph().import(url); }
        return [count(), closure()];
      `),
    ).toEqual(everywhere([2, 3]));
  });

  test.concurrent("dispose() from the graph's own code", async () => {
    expect(
      await run(`
        const graph = new Bun.ModuleGraph();
        return (await graph.import(url)).disposeAndGoOn(graph);
      `),
    ).toEqual(everywhere([1, "2,3,4"]));
  });

  test.concurrent("default class constructors", async () => {
    expect(
      await run(`
        const host = await import(url);
        const a = await new Bun.ModuleGraph().import(url);
        const b = await new Bun.ModuleGraph().import(url);
        return [
          ...[host, a, b].map(ns => [new ns.Empty() instanceof ns.Empty, new ns.Derived().field, new ns.Derived().field]),
          [a.Empty === b.Empty, new a.Derived() instanceof host.Empty, new a.Counter().next, new host.Counter().next],
        ];
      `),
    ).toEqual(
      everywhere([
        [true, 1, 2],
        [true, 1, 2],
        [true, 1, 2],
        [false, false, 4, 3],
      ]),
    );
  });

  test.concurrent("globals option", async () => {
    expect(
      await run(`
        const [x, y] = await Promise.all(["x", "y"].map(tag => new Bun.ModuleGraph({ globals: { tag } }).import(url)));
        return [x.tagInLoop(), y.tagInLoop(), x.tagInLoop(), x.tagsViaBuiltin(), y.tagsViaBuiltin(), typeof tag];
      `),
    ).toEqual(everywhere(["xxx", "yyy", "xxx", "xx", "yy", "undefined"]));
  });

  const readersOfGlobals = `
        import * as bunNamespace from "bun";
        import bunDefault, { version as bunVersion } from "bun";
        import realProcess from "node:process";
        import { setTimeout as realSetTimeout } from "node:timers";
        import { setTimeout as sleep } from "node:timers/promises";
        declare const self: typeof globalThis;
        const whenLoaded = process.env.TENANT;
        export const ownNames = () => [process.env.TENANT, whenLoaded, process.title === realProcess.title, setTimeout(() => {}, 0), clearImmediate(undefined), AbortSignal.abort(), fetch("http://localhost/"), Bun.version, console.log("not printed"), typeof postMessage, typeof Bun.file].join();
        export function ownNamesInLoop() { let all = ""; for (let i = 0; i < 3; i++) all += process.env.TENANT + String(setTimeout(() => {}, 0)); return all; }
        export class Reader { read() { return process.env.TENANT; } static async later() { await 1; return Bun.version; } }
        export function* eachOwn() { yield process.env.TENANT; yield typeof postMessage; }
        export const realOnes = () => [globalThis.setTimeout === setTimeout, globalThis.setTimeout === realSetTimeout, globalThis.process === process, globalThis.process === realProcess, "postMessage" in globalThis, typeof globalThis.postMessage, globalThis.Bun === Bun].join();
        export const importedFromBun = () => [bunNamespace === globalThis.Bun, bunDefault === globalThis.Bun, bunVersion === globalThis.Bun.version, bunNamespace === Bun].join();
        export const builtinModulesKeepTheirs = async () => [await sleep(1, "slept"), typeof realProcess.hrtime, realSetTimeout === setTimeout].join();
        export const callHere = (f: () => unknown) => f();
        export const throughTheObject = () => [(globalThis as any).own, (global as any).own, (self as any).own, "own" in globalThis, globalThis.Math.floor(1.5), new globalThis.Map().size, globalThis.parseInt("7"), globalThis === global, typeof globalThis, ((globalThis as any).stored = 1), "stored" in globalThis].join();
        export function throughTheObjectInLoop() { let sum = 0; for (let i = 0; i < 3; i++) sum += globalThis.Math.floor(1.5); return sum; }
        export const evaluated = () => [eval("tag"), eval("typeof postMessage"), eval("process.env.TENANT"), eval("spare = spare + 1"), eval("spare"), (0, eval)("typeof tag"), new Function("return typeof tag")()].join();
      `;

  test.concurrent("a host gives each graph its own process, timers, fetch, Bun and console", async () => {
    expect(
      await run(
        `
        const make = (tag: string) => ({
          tag,
          spare: tag.length,
          process: Object.create(process, { env: { value: { TENANT: tag }, enumerable: true } }),
          setTimeout: () => "timer of " + tag,
          clearImmediate: () => "cleared by " + tag,
          AbortSignal: class { static abort() { return "aborted by " + tag; } },
          fetch: () => "fetched by " + tag,
          Bun: Object.create(Bun, { version: { value: "version of " + tag } }),
          console: Object.create(console, { log: { value: () => "logged by " + tag } }),
          postMessage: undefined,
        });
        const [x, y] = await Promise.all(["x", "y"].map(tag => new Bun.ModuleGraph({ globals: make(tag) }).import(url)));
        const host = await import(url);
        return [
          x.ownNames(), y.ownNames(), x.ownNamesInLoop(), new y.Reader().read(), await x.Reader.later(), [...y.eachOwn()].join(),
          x.realOnes(), host.realOnes(), x.importedFromBun(), host.importedFromBun(), await x.builtinModulesKeepTheirs(), await host.builtinModulesKeepTheirs(),
          y.callHere(x.ownNames) === x.ownNames(), host.callHere(y.ownNames) === y.ownNames(), x.callHere(host.realOnes) === host.realOnes(), [0].map(x.ownNames)[0] === x.ownNames(),
          x.evaluated(), y.evaluated(), x.ownNames() === y.ownNames(),
        ];
      `,
        readersOfGlobals,
      ),
    ).toEqual(
      everywhere([
        "x,x,true,timer of x,cleared by x,aborted by x,fetched by x,version of x,logged by x,undefined,function",
        "y,y,true,timer of y,cleared by y,aborted by y,fetched by y,version of y,logged by y,undefined,function",
        "xtimer of xxtimer of xxtimer of x",
        "y",
        "version of x",
        "y,undefined",
        "false,true,false,true,true,function,false",
        "true,true,true,true,true,function,true",
        "true,true,true,false",
        "true,true,true,true",
        "slept,function,false",
        "slept,function,true",
        true,
        true,
        true,
        true,
        "x,undefined,x,2,2,undefined,undefined",
        "y,undefined,y,2,2,undefined,undefined",
        false,
      ]),
    );
  });

  test.concurrent("a host gives a graph its own globalThis, global and self", async () => {
    expect(
      await run(
        `
        const asked: string[] = [];
        const view = new Proxy(globalThis, {
          get: (target, key) => (asked.push(String(key)), key === "own" ? "the view's" : Reflect.get(target, key)),
          has: (target, key) => key === "own" || Reflect.has(target, key),
          set: (target, key) => (asked.push("set " + String(key)), true),
        });
        const a = await new Bun.ModuleGraph({ globals: { globalThis: view, global: view, self: view } }).import(url);
        const plain = await new Bun.ModuleGraph({ globals: { globalThis: { own: "the object's", Math: { floor: () => 41 }, Map: class extends Map { override get size() { return 41; } }, parseInt: () => 41, Bun: { version: "the object's" } } } }).import(url);
        const host = await import(url);
        return [a.throughTheObject(), a.throughTheObjectInLoop(), asked.filter(key => key !== "Bun").join(), plain.throughTheObject(), plain.throughTheObjectInLoop(), plain.importedFromBun(), host.throughTheObject(), host.throughTheObjectInLoop()];
      `,
        readersOfGlobals,
      ),
    ).toEqual(
      everywhere([
        "the view's,the view's,the view's,true,1,0,7,true,object,1,false",
        3,
        "own,own,own,Math,Map,parseInt,set stored,Math,Math,Math",
        "the object's,,,true,41,41,41,false,object,1,true",
        123,
        "true,true,true,false",
        ",,,false,1,0,7,true,object,1,true",
        3,
      ]),
    );
  });

  test.concurrent("globals cannot replace a built-in of the language", async () => {
    expect(
      await run(`
        const language = new Set("Infinity NaN undefined AggregateError Array ArrayBuffer AsyncDisposableStack Atomics BigInt BigInt64Array BigUint64Array Boolean DataView Date DisposableStack Error EvalError FinalizationRegistry Float16Array Float32Array Float64Array Function Int16Array Int32Array Int8Array Intl Iterator JSON Map Math Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer String SuppressedError Symbol SyntaxError Temporal TypeError URIError Uint16Array Uint32Array Uint8Array Uint8ClampedArray WeakMap WeakRef WeakSet WebAssembly decodeURI decodeURIComponent encodeURI encodeURIComponent escape eval isFinite isNaN parseFloat parseInt unescape".split(" "));
        const wrong: string[] = [];
        let said = "";
        for (const name of [...Object.getOwnPropertyNames(globalThis), "fresh", "toString"]) {
          try {
            await new Bun.ModuleGraph({ globals: { [name]: 1 } }).import(url);
            if (language.has(name)) wrong.push(name + " is accepted");
          } catch (error) {
            if (!language.has(name)) wrong.push(name + " is refused");
            if (name === "Math") said = (error as Error).name + ": " + (error as Error).message.split(" (bun compile")[0];
          }
        }
        return [wrong, said];
      `),
    ).toEqual(
      everywhere([
        [],
        'TypeError: The `globals` of a Bun.ModuleGraph cannot replace the global "Math" for a module that was compiled ahead of time',
      ]),
    );
  });

  test.concurrent("globals replace a built-in of the language whose name is written there", async () => {
    expect(
      await run(
        `
        const seeded = Object.create(Math, { random: { value: () => 0.5 }, floor: { value: () => 41 } });
        class Clock extends Date { override getTime() { return 41; } static override now() { return 42; } }
        const a = await new Bun.ModuleGraph({ globals: { Math: seeded, Date: Clock, parseInt: () => 43 } }).import(url);
        const b = await new Bun.ModuleGraph({ globals: { Math: undefined } }).import(url);
        const globals = { isNaN: () => "own isNaN" };
        const c = await new Bun.ModuleGraph({ globals }).import(url);
        const none = await new Bun.ModuleGraph().import(url);
        const host = await import(url);
        const tried = (f: () => unknown) => { try { return f(); } catch (error) { return (error as Error).name; } };
        const notSeen = await new Bun.ModuleGraph({ globals: { ["JS" + "ON"]: {} } }).import(url).then(() => "accepted", error => error.name);
        return [
          a.builtins(), tried(b.builtins), none.builtins(), host.builtins(), a.builtinsInLoop(), host.builtinsInLoop(),
          [new a.Stamp().at, a.Stamp.floor(1.5), new host.Stamp().at, host.Stamp.floor(1.5), a.held(), host.held()].join(),
          host.call(() => a.Stamp.floor(1.5)), [1.5].map(a.Stamp.floor)[0], await a.notByName(), await host.notByName(), c.viaVariable(), host.viaVariable(), notSeen,
        ];
      `,
        `
        export const builtins = () => [Math.random() === 0.5, Math.floor(1.5), Math.ceil(1.5), Math.PI > 3, Date.now() === 42, new Date(5).getTime(), new Date(5) instanceof Date, parseInt("7"), typeof Math, typeof JSON, globalThis.Math.floor(1.5), [1.5].map(Math.floor)[0]].join();
        export function builtinsInLoop() { let sum = 0; for (let i = 0; i < 4; i++) sum += Math.floor(i / 2) + parseInt("1"); return sum; }
        export class Stamp { at = Date.now() === 42; static floor(value: number) { return Math.floor(value); } }
        export const held = () => { const { floor } = Math; return floor(1.5); };
        export const notByName = async () => [[3, 1, 2].sort().join(""), JSON.stringify({ a: [1] }), (await Promise.resolve(5)) + 1, "" + 1.5, new Date(5).getTime() === new (Object.getPrototypeOf(Date.prototype).constructor === Object ? Date : Object.getPrototypeOf(Date))(5).getTime()].join();
        export const viaVariable = () => [isNaN(1), Boolean(0)].join();
      `,
      ),
    ).toEqual(
      everywhere([
        "true,41,2,true,true,41,true,43,object,object,1,41",
        "TypeError",
        "false,1,2,true,false,5,true,7,object,object,1,1",
        "false,1,2,true,false,5,true,7,object,object,1,1",
        336,
        6,
        "true,41,false,1,41,1",
        4101,
        41,
        '123,{"a":[1]},6,1.5,false',
        '123,{"a":[1]},6,1.5,true',
        "own isNaN,false",
        "false,false",
        "TypeError",
      ]),
    );
  });

  test.concurrent("methods and accessors of another graph's object use that graph's variables", async () => {
    expect(
      await run(`
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        const host = await import(url);
        a.count(); b.count(); b.count(); host.count(); host.count(); host.count();
        const box = a.makeBox();
        const read = [b.callMethod(box), host.callMethod(box), a.callMethod(host.makeBox()), b.readAccessor(box), host.readAccessor(b.makeBox())];
        b.writeAccessor(box, 50);
        host.writeAccessor(b.makeBox(), 70);
        return [...read, a.count(), b.count(), host.count(), b.callMethod(b.makeBox())];
      `),
    ).toEqual(everywhere([1, 1, 3, 1, 2, 51, 71, 4, 71]));
  });

  test.concurrent("records cross graphs as the objects they are", async () => {
    expect(
      await run(`
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        a.count(); b.count(); b.count();
        const point = a.makePoint(1, 2);
        return [b.movePoint(point), a.movePoint(point), point.x];
      `),
    ).toEqual(everywhere([32, 42, 4]));
  });

  const hops = `
        export type Hop = (hops: Hop[], at: number) => unknown;
        let label = "";
        const letters: string[] = [];
        export function setLabel(name: string) { label = name; letters.push(...name); }
        const said = (error: unknown) => label + letters.length + new Uint8Array(letters.length).length + " caught " + (error instanceof Error ? error.message : error);
        export const tail: Hop = (hops, at) => hops[at]!(hops, at + 1);
        export const plain: Hop = (hops, at) => { const result = hops[at]!(hops, at + 1); n++; return result; };
        export const guarded: Hop = (hops, at) => { try { return hops[at]!(hops, at + 1); } finally { n += letters.length; } };
        export const rethrows: Hop = (hops, at) => { try { return hops[at]!(hops, at + 1); } catch (error) { n += letters.length; throw error; } };
        export const applies: Hop = (hops, at) => Reflect.apply(hops[at]!, undefined, [hops, at + 1]);
        export const spreads: Hop = (hops, at) => hops[at]!(...([hops, at + 1] as [Hop[], number]));
        export const catches: Hop = (hops, at) => { try { return hops[at]!(hops, at + 1); } catch (error) { return said(error); } };
        export const throws: Hop = () => { throw new Error(label); };
        export const descends: Hop = (hops, at) => 1 + (hops[at]!(hops, at + 1) as number);
        export const restarts: Hop = hops => hops[0]!(hops, 1);
        export async function runsLater(hops: Hop[]) { await 1; return hops[0]!(hops, 1); }
        export async function catchesLater(hops: Hop[]) { const bytes = new Uint8Array(letters.length); try { await 1; return hops[0]!(hops, 1); } catch (error) { return said(error) + bytes.length; } }
        export function* yields(hops: Hop[]) { try { yield label; yield hops[0]!(hops, 1); } finally { n += letters.length; } }
        export const steps = (iterator: Iterator<unknown>) => iterator.next();
        export const throwsInto = (iterator: Iterator<unknown>) => iterator.throw!(new Error(label));
      `;
  const threeGraphs = `
        const graphs: Record<string, any> = { host: await import(url), a: await new Bun.ModuleGraph().import(url), b: await new Bun.ModuleGraph().import(url) };
        for (const name in graphs) graphs[name].setLabel(name);
        const { host, a, b } = graphs;
        const catchesHere = (hops: any[], at: number) => { try { return hops[at](hops, at + 1); } catch (error: any) { return "entry" + url.slice(-7) + " caught " + error.message; } };
      `;

  test.concurrent(
    "an exception that leaves several graphs at once is caught with the catcher's own variables",
    async () => {
      expect(
        await run(
          `${threeGraphs}
        const all = Object.values(graphs).flatMap(graph => ["tail", "plain", "guarded", "rethrows", "applies", "spreads"].map(kind => graph[kind]));
        const catchers: [string, any][] = [["entry/app.js", catchesHere], ["host44", host.catches], ["a11", a.catches], ["b11", b.catches]];
        const wrong: unknown[] = [];
        let chains = 0;
        for (const [catcherSays, catcher] of catchers)
          for (const first of all)
            for (const second of all)
              for (const third of [undefined, ...all])
                for (const thrower in graphs) {
                  const result = catcher([first, second, ...(third ? [third] : []), graphs[thrower].throws], 0);
                  chains++;
                  if (result !== catcherSays + " caught " + thrower) wrong.push(result);
                }
        return [wrong.slice(0, 3), chains, catchesHere([b.tail, a.tail, b.tail, host.tail, a.tail, b.throws], 0)];
      `,
          hops,
        ),
      ).toEqual(everywhere([[], 73872, "entry/app.js caught b"]));
    },
  );

  test.concurrent(
    "an exception that leaves several graphs at once reaches an async function with its own variables",
    async () => {
      expect(
        await run(
          `${threeGraphs}
        async function catchesLaterHere(hops: any[]) {
          const bytes = new Uint8Array(4);
          try { await 1; return hops[0](hops, 1); } catch (error: any) { bytes[1] = url.length ? 1 : 2; return "entry" + bytes.join("") + " caught " + error.message; }
        }
        async function runsLaterHere(hops: any[]) { await 1; return hops[0](hops, 1); }
        const rejected = (error: any) => "rejected with " + error.message + url.slice(-7);
        return [
          await catchesLaterHere([b.tail, a.throws]), await catchesLaterHere([a.tail, b.tail, host.throws]),
          await runsLaterHere([b.tail, a.throws]).catch(rejected), await a.runsLater([b.tail, host.tail, a.throws]).catch(rejected), await b.runsLater([host.tail, a.throws]).catch(a.catches.bind(null, [a.throws], 0)),
          await a.catchesLater([b.tail, host.throws]), await host.catchesLater([a.tail, b.throws]), await b.catchesLater([host.tail, a.tail, b.throws]),
        ];
      `,
          hops,
        ),
      ).toEqual(
        everywhere([
          "entry0100 caught a",
          "entry0100 caught host",
          "rejected with a/app.js",
          "rejected with a/app.js",
          "a11 caught a",
          "a11 caught host1",
          "host44 caught b4",
          "b11 caught b1",
        ]),
      );
    },
  );

  test.concurrent("what a built-in function throws, and a stack overflow, leave several graphs at once", async () => {
    expect(
      await run(
        `${threeGraphs}
        const named = (hops: any[]) => { try { return hops[0](hops, 1); } catch (error: any) { return error.name + url.slice(-7); } };
        return [
          named([b.tail, a.tail, Object.defineProperty]), named([a.tail, b.tail, host.tail, JSON.parse]),
          named([a.descends, b.tail, a.restarts]), named([b.tail, a.descends, b.tail, host.restarts]),
          a.catches([b.tail, host.tail, Object.defineProperty], 0).slice(0, 10), b.count(),
        ];
      `,
        hops,
      ),
    ).toEqual(
      everywhere(["TypeError/app.js", "SyntaxError/app.js", "RangeError/app.js", "RangeError/app.js", "a11 caught", 1]),
    );
  });

  test.concurrent("an exception leaves a generator that another graph steps in tail position", async () => {
    expect(
      await run(
        `${threeGraphs}
        const out: unknown[] = [];
        for (const [owner, stepper, thrower] of [[a, b, a], [a, b, host], [host, a, b], [b, host, a]]) {
          const running = owner.yields([stepper.tail, thrower.throws]);
          out.push(stepper.steps(running).value, catchesHere([() => stepper.steps(running)], 0), stepper.catches([() => owner.steps(running).done], 0));
          const waiting = owner.yields([]);
          stepper.steps(waiting);
          out.push(catchesHere([() => stepper.throwsInto(waiting)], 0), thrower.catches([stepper.tail, () => stepper.throwsInto(waiting)], 0));
        }
        return [out.join(), a.current(), b.current(), host.current()];
      `,
        hops,
      ),
    ).toEqual(
      everywhere([
        [
          ["a", "entry/app.js caught a", true, "entry/app.js caught b", "a11 caught b"],
          ["a", "entry/app.js caught host", true, "entry/app.js caught b", "host44 caught b"],
          ["host", "entry/app.js caught b", true, "entry/app.js caught a", "b11 caught a"],
          ["b", "entry/app.js caught a", true, "entry/app.js caught host", "a11 caught host"],
        ].join(),
        4,
        2,
        8,
      ]),
    );
  });

  test.concurrent("maps and sets with string keys grow in a graph's code and survive a collection", async () => {
    expect(
      await run(
        `
        const host = await import(url);
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        const out: unknown[] = [];
        for (const graph of [a, host, b, a]) {
          const filled = graph.fill(20, 40);
          Bun.gc(true);
          out.push(graph.total(filled), host.total(filled), b.total(filled));
        }
        const late = await new Bun.ModuleGraph().import(url);
        const filled = late.fill(20, 40);
        Bun.gc(true);
        out.push(late.total(filled), a.total(filled), late.total(a.fill(3, 100)));
        return out;
      `,
        `
        export function fill(count: number, keys: number) {
          const maps: Map<string, number>[] = [];
          const sets: Set<string>[] = [];
          for (let i = 0; i < count; i++) {
            const map = new Map<string, number>();
            const set = new Set<string>();
            for (let k = 0; k < keys; k++) { map.set("key" + k, k + i); set.add("member" + k); }
            maps.push(map);
            sets.push(set);
          }
          return { maps, sets };
        }
        export function total({ maps, sets }: ReturnType<typeof fill>) {
          let sum = 0;
          for (const map of maps) for (const [key, value] of map) sum += value + key.length;
          for (const set of sets) for (const member of set) sum += member.length;
          for (const map of maps) { sum += map.get("key3")! + map.size + [...map.keys()].length; map.forEach(value => { sum += value; }); }
          return sum;
        }
      `,
      ),
    ).toEqual(everywhere([...Array(14).fill(58250), 34752]));
  });

  test.concurrent(
    "a closure over the object it is stored in belongs to the graph that stored it, whoever reads it first",
    async () => {
      expect(
        await run(
          `
        const graphs: Record<string, any> = { host: await import(url), a: await new Bun.ModuleGraph().import(url), b: await new Bun.ModuleGraph().import(url) };
        for (const name in graphs) graphs[name].setOwner(name);
        const wrong: string[] = [];
        let rows = 0;
        for (const maker in graphs)
          for (const reader in graphs)
            for (const kind in graphs[maker].makers)
              for (const how in graphs[reader].readers) {
                const object = graphs[maker].makers[kind](how);
                const read = graphs[reader].readers[how](object);
                const said = [typeof read === "function" ? read() : read, object.who(), graphs[maker].readers.call(object), graphs[reader].readers.take(object)()].join();
                rows++;
                if (said !== Array(4).fill(maker + ":" + how).join()) wrong.push([maker, reader, kind, how, said].join(" "));
              }
        Bun.gc(true);
        return [wrong.slice(0, 3), rows];
      `,
          `
        let owner = "";
        export function setOwner(name: string) { owner = name; }
        class Assigned {
          who: () => string;
          constructor(public tag: string) { this.who = () => owner + ":" + this.tag; }
        }
        class Field {
          who = () => owner + ":" + this.tag;
          constructor(public tag: string) {}
        }
        function Old(this: any, tag: string) { this.tag = tag; this.who = () => owner + ":" + this.tag; }
        export const makers: Record<string, (tag: string) => any> = {
          literal(tag) { const self: { tag: string; who?: () => string } = { tag }; self.who = () => owner + ":" + self.tag; return self; },
          untyped(tag) { const self: any = {}; self.tag = tag; self.who = () => owner + ":" + self.tag; return self; },
          assigned: tag => new Assigned(tag),
          field: tag => new Field(tag),
          old: tag => new (Old as any)(tag),
        };
        export const readers: Record<string, (object: any) => any> = {
          call: object => object.who(),
          take: object => object.who,
          typed: (object: Assigned) => object.who(),
          stringify: object => (JSON.stringify(object), object.who()),
          spread: object => ({ ...object }).who(),
          entries: object => (Object.entries(object).find(([key]) => key === "who")![1] as () => string)(),
          assign: object => Object.assign({}, object).who(),
          reflect: object => Reflect.get(object, "who")(),
          descriptor: object => Object.getOwnPropertyDescriptor(object, "who")!.value(),
          destructure: ({ who }) => who(),
          computed: object => object["w" + "ho".slice(0)](),
        };
      `,
        ),
      ).toEqual(everywhere([[], 495]));
    },
  );

  test.concurrent("getters of the host's classes are read in the host and in graphs, in either order", async () => {
    expect(
      await run(
        `
        const host = await import(url);
        const [a, b] = await Promise.all([1, 2].map(() => new Bun.ModuleGraph().import(url)));
        const out: string[] = [];
        for (const order of [[host, a, b], [b, host, a]])
          for (const graph of order) for (let i = 0; i < 3; i++) out.push(graph.readAll());
        Bun.gc(true);
        const late = await new Bun.ModuleGraph().import(url);
        out.push(late.readAll(), host.readAll(), a.readAll());
        return [...new Set(out)];
      `,
        `
        const read = (object: any, name: string) => object[name];
        const status = (response: any) => response.status;
        const method = (request: any) => request.method;
        const href = (url: any) => url.href;
        const size = (blob: any) => blob.size;
        const nameOf = (error: any) => error.name;
        const aborted = (controller: any) => controller.signal.aborted;
        export function readAll() {
          let thrown = "";
          try { structuredClone(() => 1); } catch (error) { thrown = (error as Error).name; }
          return [
            status(new Response("x", { status: 201 })), method(new Request("http://x/", { method: "PUT" })), href(new URL("http://x/y")), size(new Blob(["abc"])),
            nameOf(new DOMException("m", "AbortError")), aborted(new AbortController()), thrown, read(new Response("x"), "ok"), read(new URL("http://x/y?z"), "search"),
          ].join();
        }
      `,
      ),
    ).toEqual(everywhere(["201,PUT,http://x/y,3,AbortError,false,DataCloneError,true,?z"]));
  });

  test.concurrent("600 graphs at once", async () => {
    expect(
      await run(`
        const all = [];
        for (let i = 0; i < 600; i++) all.push(await new Bun.ModuleGraph().import(url));
        all.forEach((each, i) => { for (let j = 0; j <= i % 3; j++) each.count(); });
        return all.reduce((sum, each) => sum + each.count(), 0);
      `),
    ).toEqual(everywhere(1800));
  });

  test.concurrent("dispose() frees modules while the host keeps the graph", async () => {
    expect(
      await run(`
        const registry = new FinalizationRegistry(() => collected++);
        let collected = 0;
        const graphs = [];
        for (let i = 0; i < 40; i++) {
          const graph = new Bun.ModuleGraph();
          registry.register((await graph.import(url)).count, 0);
          graph.dispose();
          graphs.push(graph);
        }
        for (let i = 0; i < 5 && collected < 30; i++) { Bun.gc(true); await new Promise(done => setTimeout(done, 1)); }
        return [collected >= 30, graphs.length];
      `),
    ).toEqual(everywhere([true, 40]));
  });

  test.concurrent("a closure survives dispose() while the host keeps the graph", async () => {
    expect(
      await run(`
        const graphs = [], closures = [];
        for (let i = 0; i < 20; i++) {
          const graph = new Bun.ModuleGraph();
          const ns = await graph.import(url);
          const f = ns.viaClosure();
          f.extra = i;
          delete f.extra;
          closures.push(f);
          graph.dispose();
          graphs.push(graph);
        }
        for (let i = 0; i < 3; i++) { Bun.gc(true); await new Promise(done => setTimeout(done, 1)); }
        return closures.map(f => f() + f()).join();
      `),
    ).toEqual(everywhere(Array(20).fill(3).join()));
  });

  test.concurrent("dropped graphs are collected", async () => {
    expect(
      await run(`
        const registry = new FinalizationRegistry(() => collected++);
        let collected = 0;
        for (let i = 0; i < 40; i++) {
          const graph = new Bun.ModuleGraph();
          registry.register((await graph.import(url)).count, 0);
          graph.dispose();
        }
        for (let i = 0; i < 5 && collected < 30; i++) { Bun.gc(true); await new Promise(done => setTimeout(done, 1)); }
        return collected >= 30;
      `),
    ).toEqual(everywhere(true));
  });
});

test.concurrent("builds that run at once, and one by a Bun without a JIT, write the same file", async () => {
  using dir = tempDir("compile-aot-reproducible", {
    "entry.ts": `
      const classes = [
        (() => class { a; b; c; constructor(x: number) { this.a = x; this.b = x + 1; this.c = x + 2; } sum() { return this.a + this.b + this.c; } })(),
        (() => class { d; e; f; constructor(x: number) { this.d = x; this.e = x + 1; this.f = x + 2; } sum() { return this.d + this.e + this.f; } })(),
        (() => class { g; h; i; constructor(x: number) { this.g = x; this.h = x + 1; this.i = x + 2; } sum() { return this.g + this.h + this.i; } })(),
        (() => class { j; k; l; constructor(x: number) { this.j = x; this.k = x + 1; this.l = x + 2; } sum() { return this.j + this.k + this.l; } })(),
      ];
      console.log(classes.map((C, i) => new C(i).sum()).join(), /(\\d+)-(\\w+)/.exec("abc 123-foo")!.slice(1).join());
    `,
  });
  const hashes = await Promise.all(
    [{}, {}, { BUN_JSC_useJIT: "0" }].map(async (env, i) => {
      const outfile = join(String(dir), String(i), "out.exe");
      const { stderr, exitCode } = await runCommand(
        [bunExe(), "build", "--compile", "--aot", "entry.ts", "--outfile", outfile],
        String(dir),
        { ...bunEnv, ...env },
      );
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return Bun.SHA256.hash(await Bun.file(outfile).bytes(), "hex");
    }),
  );
  expect(new Set(hashes).size).toBe(1);
  expect(await runCommand([join(String(dir), "0", "out.exe")])).toMatchObject({
    stdout: "3,6,9,12 123,foo\n",
    exitCode: 0,
  });
});

test.concurrent("--aot requires --compile", async () => {
  using dir = tempDir("compile-aot-requires-compile", { "entry.ts": `console.log(1);` });
  const { stderr, exitCode } = await runCommand(
    [bunExe(), "build", "--aot", "entry.ts", "--outdir", "out"],
    String(dir),
  );
  expect(stderr).toContain("--aot requires --compile");
  expect(exitCode).not.toBe(0);
});

describe("--aot across threads", () => {
  async function run(files: Record<string, string>, entryPoints: string[], env: Record<string, string> = {}) {
    using dir = tempDir("compile-aot-threads", files);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "--splitting", ...entryPoints, "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
    const { stdout, stderr, exitCode } = await runCommand([join(String(dir), "out")], undefined, { ...bunEnv, ...env });
    return { stdout, stderr, exitCode };
  }

  const churn = `
    let n = 0;
    const kept: unknown[] = [];
    class Node { next?: Node; constructor(public value: number) {} }
    class Empty {}
    export function churn(rounds: number) {
      let head: Node | undefined;
      for (let i = 0; i < rounds; i++) {
        const node = new Node(i);
        node.next = i % 50 ? head : undefined;
        head = node;
        if (/(\\d)5$/.test(String(i))) kept.push({ i, text: "t" + i, empty: new Empty(), f: () => n + i });
        if (kept.length > 200) kept.length = 0;
        n += [i, i + 1].map(x => x & 3).reduce((a, b) => a + b, 0);
      }
      return n;
    }
    export function spin(turns: Int32Array) { for (;;) turns[0]++; }
  `;

  // A Worker that fails says so to whoever listens, and ends. A main thread that only waits for its message waits for ever, at a full core.
  const answerOf = `
    function answerOf(worker: Worker) {
      return new Promise((done, fail) => {
        worker.onmessage = e => done(e.data);
        worker.onerror = e => fail(new Error(e.message));
        worker.addEventListener("close", () => fail(new Error("the Worker has ended without an answer")));
      });
    }
  `;

  // Bun.ModuleGraph does not find the files of an executable that was built with --aot.
  test.todo("120 sequential Workers with graphs", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            ${answerOf}
            const url = new URL("./app.js", import.meta.url).href;
            if (Bun.isMainThread) {
              const results = new Set();
              for (let i = 0; i < 120; i++) {
                const worker = new Worker(import.meta.url);
                results.add(await answerOf(worker));
                const closed = new Promise(done => worker.addEventListener("close", done));
                worker.terminate();
                await closed;
              }
              console.log(JSON.stringify([...results]));
            } else {
              const graphs = await Promise.all([1, 2, 3].map(() => new Bun.ModuleGraph().import(url)));
              postMessage(graphs.map(ns => ns.churn(2000)).join());
            }
          `,
          "app.ts": churn,
        },
        ["entry.ts", "app.ts"],
      ),
    ).toEqual({ stdout: `["6000,6000,6000"]\n`, stderr: "", exitCode: 0 });
  });

  // As above.
  test.todo("graphs under GC stress", async () => {
    expect(
      await run(
        {
          "entry.ts": `
            ${answerOf}
            const url = new URL("./app.js", import.meta.url).href;
            if (Bun.isMainThread) {
              const workers = [1, 2, 3].map(() => new Worker(import.meta.url));
              const results = await Promise.all(workers.map(answerOf));
              workers.forEach(worker => worker.terminate());
              console.log(JSON.stringify([...new Set(results)]));
            } else {
              let out = [];
              for (let round = 0; round < 6; round++) {
                const graphs = await Promise.all([1, 2, 3, 4].map(() => new Bun.ModuleGraph().import(url)));
                out = graphs.map(ns => ns.churn(30000));
              }
              postMessage(out.join());
            }
          `,
          "app.ts": churn,
        },
        ["entry.ts", "app.ts"],
        { BUN_JSC_slowPathAllocsBetweenGCs: "20" },
      ),
    ).toEqual({ stdout: `["90000,90000,90000,90000"]\n`, stderr: "", exitCode: 0 });
  });
});
