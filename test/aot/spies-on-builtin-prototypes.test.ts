import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const library = {
  "texts.ts": `
    export function plain(s: string): string { return s.normalize("NFC"); }
    export function maybe(s?: string): string | undefined { return s?.normalize(); }
    export function where(s: string, list: string[]): string { return s.indexOf("b") + "," + list.indexOf("b"); }
    export function byPath(s: string): string { return String.prototype.normalize.call(s); }
    export function own(o: { normalize(): string }): string { return o.normalize(); }
    export function sorted(list: string[]): string { return [...list].sort((a, b) => a.localeCompare(b)).join(); }
    export function got(m: Map<string, number>): number | undefined { return m.get("a"); }
    export function iso(d: Date): string { return d.toISOString(); }
    const D = Date;
    export function byAlias(): number { return D.now(); }
    export function handed(holder: { now(): number }): number { return holder.now(); }
    export function reflected(): number { return Reflect.get(Date, "now")(); }
  `,
  "untyped.js": `export function plainFromJs(s) { return s.normalize(); }`,
};

const header = `
  import { expect, mock, spyOn, test } from "bun:test";
  import * as texts from "./texts";
  import { plainFromJs } from "./untyped.js";
`;

const cases: Record<string, Record<string, string>> = {
  "a spy that calls through counts the calls and their receivers": {
    ...library,
    "main.test.ts": `${header}
      test("case", () => {
        const spy = spyOn(String.prototype, "normalize");
        console.log("see:", texts.plain("a"), texts.maybe("b"), texts.maybe(), plainFromJs("c"), texts.byPath("d"), texts.own({ normalize: () => "own" }), "e".normalize());
        console.log("see:", spy.mock.calls.length, JSON.stringify(spy.mock.calls), spy.mock.contexts.join());
        expect(spy).toHaveBeenCalledTimes(5);
        spy.mockRestore();
        console.log("see:", texts.plain("a"), spy.mock.calls.length);
      });
    `,
  },
  "a spy with a value, lifted at the end of its block": {
    ...library,
    "main.test.ts": `${header}
      test("case", () => {
        {
          using _spy = spyOn(String.prototype, "normalize").mockReturnValue("spied");
          console.log("see:", texts.plain("a"), texts.maybe("b"), plainFromJs("c"), texts.byPath("d"), texts.own({ normalize: () => "own" }));
        }
        console.log("see:", texts.plain("a"), plainFromJs("c"));
      });
    `,
  },
  "of two prototypes with a method of one name, the one that is spied on answers": {
    ...library,
    "main.test.ts": `${header}
      test("case", () => {
        const ofStrings = spyOn(String.prototype, "indexOf").mockReturnValue(40);
        console.log("see:", texts.where("abc", ["a", "b"]), ofStrings.mock.calls.length);
        const ofArrays = spyOn(Array.prototype, "indexOf").mockReturnValue(50);
        console.log("see:", texts.where("abc", ["a", "b"]), ofStrings.mock.calls.length, ofArrays.mock.calls.length);
        mock.restore();
        console.log("see:", texts.where("abc", ["a", "b"]));
      });
    `,
  },
  "other prototypes": {
    ...library,
    "main.test.ts": `${header}
      test("case", () => {
        const compared = spyOn(String.prototype, "localeCompare");
        spyOn(Map.prototype, "get").mockReturnValue(9);
        spyOn(Date.prototype, "toISOString").mockReturnValue("spied");
        console.log("see:", texts.sorted(["b", "a", "c"]), compared.mock.calls.length > 0, texts.got(new Map([["a", 1]])), texts.iso(new Date(0)));
        mock.restore();
        console.log("see:", texts.sorted(["b", "a"]), texts.got(new Map([["a", 1]])), texts.iso(new Date(0)));
      });
    `,
  },
  "a member of a built-in object that is reached under another name": {
    ...library,
    "main.test.ts": `${header}
      test("case", () => {
        const spy = spyOn(Date, "now").mockReturnValue(1000);
        console.log("see:", texts.byAlias(), texts.handed(Date), texts.reflected(), Date.now === spy, spy.mock.calls.length);
        spy.mockRestore();
        console.log("see:", texts.byAlias() > 1_000_000, texts.handed(Date) > 1_000_000, Date.now === spy);
      });
    `,
  },
  "a function of the global object": {
    "codes.ts": `
      export function coded(text: string): string { return encodeURIComponent(text); }
      export function byTheObject(text: string): string { return globalThis.encodeURIComponent(text); }
      export function parsed(text: string): number { return parseInt(text, 10) + 1; }
      export function kind(): string { return typeof encodeURIComponent; }
      const kept = encodeURIComponent;
      export function byWhatWasKept(text: string): string { return kept(text); }
    `,
    "main.test.ts": `
      import { mock, spyOn, test } from "bun:test";
      import * as codes from "./codes";
      test("case", () => {
        const spy = spyOn(globalThis, "encodeURIComponent").mockReturnValue("spied");
        const counted = spyOn(globalThis, "parseInt");
        console.log("see:", codes.coded("a b"), codes.byTheObject("a b"), codes.byWhatWasKept("a b"), encodeURIComponent("a b"), codes.kind(), spy.mock.calls.length);
        console.log("see:", codes.parsed("41"), counted.mock.calls.length, JSON.stringify(counted.mock.calls));
        console.log("see:", spyOn(globalThis, "encodeURIComponent") === spy, encodeURIComponent === spy);
        mock.restore();
        console.log("see:", codes.coded("a b"), codes.byTheObject("a b"), codes.parsed("41"), encodeURIComponent === spy);
      });
    `,
  },
};

async function seen(cwd: string, args: string[]) {
  await using ran = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: %s",
  async name => {
    using dir = tempDir("spies-on-builtin-prototypes", cases[name]);
    const plain = await seen(String(dir), ["test", "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
