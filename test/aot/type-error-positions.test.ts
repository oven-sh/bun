// A type error stops `bun build --compile --aot`, and `bun run --aot`, wherever it stands in code that runs. Each row is a program that reaches
// the places marked BAD, where `(1 as number).nope` is written: TS2339. An error in code that nothing reaches does not stop a build, so what
// is asked here is whether the compiler knows of each place that it is reached.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

// prettier-ignore
const everyKindOfPlace = [
  "console.log(BAD);",
  "const a = BAD; console.log(a);",
  "function f() { return BAD; } console.log(f());",
  "function f(a = BAD) { return a; } console.log(f());",
  "const f = (a = BAD) => a; console.log(f());",
  "const f = () => BAD; const g = () => f(); console.log(g());",
  "const f = function () { return BAD; }; function g() { return f(); } console.log(g());",
  "const f = (a = BAD) => a; const g = () => f(); console.log(g());",
  "const f = () => BAD; function run(g: () => unknown) { return g(); } console.log(run(() => f()));",
  "class K { f = BAD; } console.log(new K().f);",
  "class K { static f = BAD; } console.log(K.f);",
  "class K { static { console.log(BAD); } } console.log(new K());",
  "class K { [String(BAD)]() {} } console.log(new K());",
  "class K { [String(BAD)] = 1; } console.log(new K());",
  "class K { get g() { return BAD; } } console.log(new K().g);",
  "class K { set s(v: number) { console.log(BAD); } } new K().s = 1;",
  "class K { constructor(public p = BAD) {} } console.log(new K().p);",
  "class K { m(a = BAD) { return a; } } console.log(new K().m());",
  "class K { #p = BAD; r() { return this.#p; } } console.log(new K().r());",
  "class K { accessor a = BAD; } console.log(new K().a);",
  "class B {} class K extends (BAD, B) {} console.log(new K());",
  "const d = (v: any, c: any) => v; @(BAD, d) class K {} console.log(new K());",
  "const d = (x: any) => (v: any, c: any) => v; class K { @d(BAD) f = 1; } console.log(new K());",
  "const d = (x: any) => (v: any, c: any) => v; @d(BAD) class K {} console.log(new K());",
  "const o = { a: BAD }; console.log(o);",
  "const o = { [String(BAD)]: 1 }; console.log(o);",
  "const o = { ...{ a: BAD } }; console.log(o);",
  "const o = { m() { return BAD; } }; console.log(o.m());",
  "const o = { get g() { return BAD; } }; console.log(o.g);",
  "const a = [BAD]; console.log(a);",
  "const a = [...[BAD]]; console.log(a);",
  "console.log(`${BAD}`);",
  "console.log(String.raw`${BAD}`);",
  "const { a = BAD } = {} as { a?: unknown }; console.log(a);",
  "const [a = BAD] = [] as unknown[]; console.log(a);",
  "for (const x of [BAD]) console.log(x);",
  "for (const k in { [String(BAD)]: 1 }) console.log(k);",
  "for (let i = 0; i < 1; i++, BAD) console.log(i);",
  "for (let i = (BAD, 0); i < 1; i++) console.log(i);",
  "while (BAD) break; console.log(1);",
  "do { console.log(1); } while (BAD);",
  "if (BAD) console.log(1); else console.log(2);",
  "switch (BAD) { default: console.log(1); }",
  "switch (1 as number) { case BAD: console.log(1); break; default: console.log(2); }",
  "try { throw BAD; } catch (e) { console.log(e); }",
  "try { console.log(1); } finally { console.log(BAD); }",
  "label: { console.log(BAD); break label; }",
  "console.log(BAD ? 1 : 2, true ? BAD : 2, BAD ?? 1, BAD || 1, BAD && 1, (BAD, 1));",
  "console.log(typeof BAD, void BAD, !BAD, -BAD);",
  "console.log((BAD) as unknown, (BAD)!, BAD satisfies unknown, <unknown>BAD);",
  "console.log(({} as any)[BAD], ({} as any)?.[BAD], ({} as any).f?.(BAD));",
  "console.log(new Array(BAD), new (class { constructor(a: unknown) {} })(BAD));",
  "enum E { A = BAD } console.log(E.A);",
  "namespace N { export const a = BAD; } console.log(N.a);",
  "namespace N { console.log(BAD); } console.log(1);",
  "function* g() { yield BAD; } console.log([...g()]);",
  "async function f() { return await BAD; } f().then(console.log);",
  "const f = async () => BAD; f().then(console.log);",
  "console.log(await BAD); export {};",
  "export default BAD;",
  "export const a = BAD; console.log(a);",
  "using u = (BAD, null); console.log(1);",
  "console.log((() => BAD)());",
  "console.log((function () { return BAD; })());",
  "console.log([1].map(() => BAD));",
  "setTimeout(() => console.log(BAD), 0);",
  "Promise.resolve().then(() => console.log(BAD));",
  "function f(this: unknown) { return BAD; } console.log(f.call(null));",
  "function f(...r: unknown[]) { return r; } console.log(f(...[BAD]));",
  "let a; a = BAD; console.log(a);",
  "let a = 1 as unknown; a ??= BAD; a ||= BAD; console.log(a);",
  "const o: any = {}; o.p = BAD; o[BAD] = 1; console.log(o);",
  "console.log(import.meta.url.length + BAD);",
  "function f<T>(a: T) { return a; } console.log(f<unknown>(BAD));",
  "const t = (s: TemplateStringsArray, ...v: unknown[]) => v; console.log(t`${BAD}`);",
  "class K { static m() { return BAD; } } console.log(K.m());",
  "abstract class A { m() { return BAD; } } class K extends A {} console.log(new K().m());",
  "class A { m() { return 1 as unknown; } } class K extends A { m() { return (super.m(), BAD); } } console.log(new K().m());",
  "const K = class { f = BAD; }; console.log(new K().f);",
  "function outer() { function inner() { return BAD; } return inner(); } console.log(outer());",
  "function outer() { class L { f = BAD; } return new L().f; } console.log(outer());",
];

/** The place runs, and right beside it is what a constant cuts out of the program. */
// prettier-ignore
const besideWhatAConstantCuts = [
  "if (false) { console.log(0); } else { console.log(BAD); }",
  "console.log(false ? 1 : BAD);",
  "console.log(true ? BAD : 1);",
  "console.log(true && BAD);",
  "console.log(false || BAD);",
  "console.log(null ?? BAD);",
  "console.log(undefined ?? BAD);",
  "if (true) console.log(BAD);",
  "if (false) { console.log(0); } console.log(BAD);",
  "for (; false; ) { console.log(0); } console.log(BAD);",
  "while (false) { console.log(0); } console.log(BAD);",
  "const DEBUG = false; if (!DEBUG) console.log(BAD);",
  "const DEBUG = false; if (DEBUG) { console.log(0); } else console.log(BAD);",
  "const DEBUG = false; console.log(DEBUG ? 0 : BAD);",
  "const DEBUG = false; function f() { if (DEBUG) return 0; return BAD; } console.log(f());",
  "const MODE: string = \"a\"; if (MODE === \"a\") console.log(BAD);",
  "const MODE = \"a\"; if (MODE === \"a\") console.log(BAD);",
  "const MODE = \"a\"; switch (MODE) { case \"a\": console.log(BAD); }",
  "const MODE = \"a\"; console.log(MODE !== \"a\" ? 0 : BAD);",
  "if (typeof window === \"undefined\") console.log(BAD);",
  "if (typeof window !== \"undefined\") { console.log(0); } else { console.log(BAD); }",
  "if (typeof Bun !== \"undefined\") console.log(BAD);",
  "if (process.env.NODE_ENV !== \"production\") console.log(BAD);",
  "if (process.env.NODE_ENV === \"production\") { console.log(0); } else { console.log(BAD); }",
  `if (process.platform !== "${process.platform === "win32" ? "linux" : "win32"}") console.log(BAD);`,
  "if (true) { function g() { return BAD; } console.log(g()); }",
  "function f() { return g(); function g() { return BAD; } } console.log(f());",
  "function f() { if (false) { return 0; } return BAD; } console.log(f());",
  "function f() { try { return 1; } finally { console.log(BAD); } } console.log(f());",
  "function f(a: boolean) { if (a) return 1; return BAD; } console.log(f(false));",
  "function f() { for (;;) { break; } return BAD; } console.log(f());",
  "function f() { do { continue; } while (false); return BAD; } console.log(f());",
  "function f() { l: { break l; } return BAD; } console.log(f());",
  "function f() { try { throw 1; } catch { return BAD; } } console.log(f());",
  "function f() { switch (1 as number) { case 1: return BAD; } return 0; } console.log(f());",
  "enum E { A = 1 } if (E.A === 1) console.log(BAD);",
  "const enum E { A = 1 } if (E.A === 1) console.log(BAD);",
  "const enum E { A = 1 } console.log(E.A === 1 ? BAD : 0);",
  "console.log(1 + 1 === 2 ? BAD : 0);",
  "console.log(\"a\".length === 1 ? BAD : 0);",
  "console.log(!0 && BAD, !1 || BAD, !!1 && BAD);",
  "console.log(void 0 === undefined ? BAD : 0);",
  "console.log([].length ? 0 : BAD);",
  "import.meta.main && console.log(BAD);",
  "if (import.meta.main) console.log(BAD);",
  "if (!import.meta.main) { console.log(0); } else console.log(BAD);",
  "export {}; if (import.meta.env?.X === undefined) console.log(BAD);",
  "const o = { a: false } as const; if (!o.a) console.log(BAD);",
  "const t = [false] as const; if (!t[0]) console.log(BAD);",
  "function never(): never { throw 1; } try { never(); } catch { console.log(BAD); }",
  "function assert(x: unknown): asserts x {} assert(false); console.log(BAD);",
  "let x: 1 | 2 = 1; if (x === 1) console.log(BAD);",
  "declare const D: boolean | undefined; if (typeof D === \"undefined\") console.log(BAD);",
];

describe.skipIf(!!unsupported).concurrent("compile/aot/type errors wherever they stand", () => {
  const root = String(tempDir("aot-type-errors", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  [...everyKindOfPlace, ...besideWhatAConstantCuts].forEach((row, index) => {
    test(
      row,
      () =>
        slot(async () => {
          const folder = join(root, String(index));
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, "main.ts"), row.replaceAll("BAD", "(1 as number).nope") + "\n");
          const places = row.split("BAD").length - 1;
          const isFound = (run: { stdout: string; stderr: string }) =>
            (run.stdout + run.stderr).split("Property 'nope' does not exist on type 'number'").length - 1 === places;
          const build = await spawned(
            [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(folder, "program")],
            folder,
            bunEnv,
          );
          expect({ signal: build.signal, exitCode: build.exitCode, isFound: isFound(build) }).toEqual({
            signal: null,
            exitCode: 1,
            isFound: true,
          });
          const fromSources = await spawned([bunExe(), "run", "--aot", "main.ts"], folder, bunEnv);
          expect({
            signal: fromSources.signal,
            exitCode: fromSources.exitCode,
            isFound: isFound(fromSources),
            stdout: fromSources.stdout,
          }).toEqual({ signal: null, exitCode: 1, isFound: true, stdout: "" });
        }),
      600_000,
    );
  });
});
