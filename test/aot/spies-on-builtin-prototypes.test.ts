import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const library = {
  "texts.ts": `
    const D = Date;
    export function byAlias(): number { return D.now(); }
    export function handed(holder: { now(): number }): number { return holder.now(); }
    export function reflected(): number { return Reflect.get(Date, "now")(); }
  `,
};

const header = `
  import { spyOn, test } from "bun:test";
  import * as texts from "./texts";
`;

// A member of a built-in prototype is read-only under --aot: spyOn() throws a TypeError for it.
const cases: Record<string, Record<string, string>> = {
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
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
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
