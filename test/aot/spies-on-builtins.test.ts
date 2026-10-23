import { expect, setDefaultTimeout, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

setDefaultTimeout(120_000);

const clock = {
  "clock.ts": `
    export function now(): number { return Date.now(); }
    export function roll(): number { return Math.floor(Math.random() * 6); }
    const kept = Date.now;
    export function viaKept(): boolean { return kept() > 1_000_000; }
    export function stamp(): string { return new Date(Date.now()).toISOString(); }
    export function passed(): number { return [0].map(Date.now)[0]; }
    export function elapsed(since: number): number { return Date.now() - since; }
    export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }
    export function largest(): number { return Math.max(1, 2); }
    export function decoded(): unknown { return JSON.parse("[1]"); }
  `,
  "plain.js": `
    export function nowFromJs() { return Date.now(); }
    export function rollFromJs() { return Math.random() * 2; }
  `,
};

const header = `
  import { afterEach, beforeEach, expect, jest, mock, spyOn, test } from "bun:test";
  import * as clock from "./clock";
  import { nowFromJs, rollFromJs } from "./plain.js";
`;

const cases: Record<string, Record<string, string>> = {
  "Date.now returns what the spy returns, until it is restored": {
    ...clock,
    "main.test.ts": `${header}
      test("case", () => {
        const spy = spyOn(Date, "now").mockReturnValue(1000);
        console.log("see:", clock.now(), clock.viaKept(), clock.stamp(), clock.passed(), clock.elapsed(400), nowFromJs(), Date.now(), spy.mock.calls.length, clock.parsed());
        expect(Date.now).toHaveBeenCalled();
        console.log("see:", spyOn(Date, "now") === spy, Date.now === spy);
        spy.mockRestore();
        console.log("see:", clock.now() > 1_000_000, nowFromJs() > 1_000_000, Date.now === spy);
      });
    `,
  },
  "Math.random, and mock.restore()": {
    ...clock,
    "main.test.ts": `${header}
      test("case", () => {
        const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);
        console.log("see:", clock.roll(), rollFromJs(), Math.random(), spy.mock.calls.length, clock.largest());
        mock.restore();
        console.log("see:", clock.roll() < 6, Math.random() < 1);
      });
    `,
  },
  "an implementation, and a spy that calls through": {
    ...clock,
    "main.test.ts": `${header}
      test("case", () => {
        let time = 0;
        spyOn(Date, "now").mockImplementation(() => (time += 10));
        console.log("see:", clock.now(), clock.now(), clock.elapsed(0));
        mock.restore();
        const spy = spyOn(Date, "now");
        console.log("see:", clock.now() > 1_000_000, spy.mock.calls.length);
        spy.mockRestore();
      });
    `,
  },
  "a spy laid before each test": {
    ...clock,
    "main.test.ts": `${header}
      beforeEach(() => { spyOn(Date, "now").mockReturnValue(5); });
      afterEach(() => { mock.restore(); });
      test("one", () => { console.log("see:", clock.now()); });
      test("two", () => { console.log("see:", clock.now(), clock.elapsed(1)); });
    `,
  },
  "JSON.parse": {
    ...clock,
    "main.test.ts": `${header}
      test("case", () => {
        const spy = spyOn(JSON, "parse").mockReturnValue({ mocked: true });
        console.log("see:", JSON.stringify(clock.decoded()), spy.mock.calls.length);
        spy.mockRestore();
        console.log("see:", JSON.stringify(clock.decoded()));
      });
    `,
  },
  "no spy": {
    ...clock,
    "main.test.ts": `${header}
      test("case", () => { console.log("see:", clock.now() > 1_000_000, clock.roll() < 6, clock.viaKept(), clock.parsed(), clock.largest(), nowFromJs() > 1_000_000, rollFromJs() < 2); });
    `,
  },
  "a mock that supplies undefined and null": {
    "a.ts": `
      export const limit: number | undefined = 5;
      export const label: string | null = "real";
      export function helper(): string { return "real helper"; }
    `,
    "user.ts": `
      import { limit, label, helper } from "./a";
      export function all(): string { return [String(limit), String(label), limit ?? "none", label ?? "none", helper()].join(); }
    `,
    "main.test.ts": `
      import { mock, spyOn, test } from "bun:test";
      import * as a from "./a";
      import { all } from "./user";
      test("case", () => {
        console.log("see:", all());
        const spy = spyOn(a, "helper").mockReturnValue("spied helper");
        console.log("see:", all());
        spy.mockRestore();
        console.log("see:", all());
        mock.module("./a", () => ({ limit: undefined, label: null, helper: a.helper }));
        console.log("see:", all());
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
    using dir = tempDir("spies-on-builtins", cases[name]);
    const plain = await seen(String(dir), ["test", "./main.test.ts"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect(await seen(String(dir), ["test", "--aot", "./main.test.ts"])).toEqual(plain);
  },
  120_000,
);
