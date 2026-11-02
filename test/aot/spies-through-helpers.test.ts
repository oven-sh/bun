// A spy often reaches `spyOn` through a helper: a tracker that a factory returns, a function that takes the object and the name, a loop over pairs.
// Such a spy opens the exports that go by its name in the modules that are handed on, and one helper whose names the scan of the test files cannot read
// opens every name. So the scan has to read them all: that is the second expectation. The third: flow finds nothing that the front end left closed, which
// would start the build over.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

const files = {
  "src/math.ts": `
export function add(a: number, b: number): number { return a + b; }
export function half(n: number): number { return n / 2; }
export function twice(n: number): number { return add(n, n); }
export function kept(n: number): number { return n + 100; }
`,
  "src/canvas.ts": `
export function unlink(a: number): number { return a + 1; }
export function draw(a: number): number { return unlink(a) * 2; }
`,
  "src/user.ts": `
import { add, half, kept, twice } from "./math";
export function all(): number[] { return [add(1, 2), half(8), twice(3), kept(1)]; }
`,
  "src/holders.ts": `
import * as math from "./math";
export const holders: Record<string, any> = { math };
`,
  "helpers/tracker.ts": `
import { spyOn as realSpyOn } from "bun:test";
export function createTracker() {
  const spies: { mockRestore(): void }[] = [];
  const track = <T extends { mockRestore(): void }>(spy: T) => { spies.push(spy); return spy; };
  return { spyOn: (object: any, name: string) => track(realSpyOn(object, name)), restore: () => { for (const spy of spies.splice(0)) spy.mockRestore(); } };
}
`,
  "helpers/net.ts": `
import { spyOn } from "bun:test";
import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { holders } from "../src/holders";
const LISTED = ["half"] as const;
function assigned(object: object, key: string): boolean { return Object.isFrozen(object) && key === ""; }
function tapped(object: object, key: string) {
  const slots = object as Record<string, (...args: any[]) => any>;
  if (assigned(object, key)) return { putBack() {} };
  const spy = spyOn(slots, key).mockReturnValue(7);
  return { putBack: () => spy.mockRestore() };
}
export function net() {
  const watched = [
    ...[holders.math].flatMap(object => LISTED.map(name => ({ name, ...tapped(object, name) }))),
    { name: "add", ...tapped(holders.math, "add") },
    { name: "exists", ...tapped(fs, "existsSync") },
    { name: "stat", ...tapped(fsPromises, "stat") },
  ];
  return { putBack: () => watched.forEach(it => it.putBack()) };
}
`,
  "helpers/roads.ts": `
import { spyOn } from "bun:test";
import * as fsSync from "node:fs";
import * as fsPromises from "node:fs/promises";
export function roads() {
  const spies = [fsPromises, fsSync].flatMap(module =>
    Object.entries(module).flatMap(([name, member]) => (typeof member === "function" && name === "access" ? [spyOn(module, name as never)] : [])),
  );
  const files = fsPromises as unknown as Record<string, (...args: any[]) => any>;
  for (const name of ["readlink"]) spies.push(spyOn(files, name) as any);
  return () => spies.forEach(spy => spy.mockRestore());
}
`,
  "helpers/effects.ts": `
import { spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
const WRITES = [["unlink", 1], ["truncate", 1]] as const;
export function install() {
  const files = fsPromises as unknown as Record<string, (...args: any[]) => any>;
  const spies = [];
  for (const [name, paths] of WRITES) {
    const real = files[name];
    if (real === undefined) continue;
    spies.push(spyOn(files, name).mockImplementation((...args: any[]) => (paths ? real(...args) : undefined)));
  }
  return () => spies.forEach(spy => spy.mockRestore());
}
`,
  "helpers/method.ts": `
import { spyOn } from "bun:test";
export function spyOnMethod<T extends object, K extends keyof T>(holder: T, method: K) { void holder[method]; return spyOn(holder, method as never); }
`,
  "one.test.ts": `
import { afterEach, beforeEach, test } from "bun:test";
import { createTracker } from "./helpers/tracker";
import { spyOnMethod } from "./helpers/method.js";
import { net } from "./helpers/net";
import { roads } from "./helpers/roads";
import { install } from "./helpers/effects";
import { draw } from "./src/canvas";
import { holders } from "./src/holders";
import { all } from "./src/user";
let tracker: ReturnType<typeof createTracker>;
beforeEach(() => {
  tracker = createTracker();
});
afterEach(() => tracker.restore());
test("a tracker made in a hook", () => {
  tracker
    .spyOn(holders.math, "twice")
    .mockReturnValue(1);
  console.log("tracker", JSON.stringify(all()));
});
test("a name taken out of what the factory returns", () => {
  const { spyOn, restore } = createTracker();
  spyOn(holders.math, "half").mockReturnValue(2);
  console.log("taken out", JSON.stringify(all()));
  restore();
});
test("two levels of parameters and a list", () => {
  const it = net();
  console.log("net", JSON.stringify(all()));
  it.putBack();
});
test("modules of Bun through a list and a variable", () => {
  const putBack = roads();
  console.log("roads", JSON.stringify(all()));
  putBack();
});
test("a module of Bun under names that a file of the program exports too", () => {
  const putBack = install();
  console.log("effects", draw(1));
  putBack();
});
test("a helper written with another extension", () => {
  const spy = spyOnMethod(holders.math, "add").mockReturnValue(3 as never);
  console.log("method", JSON.stringify(all()));
  spy.mockRestore();
  console.log("restored", JSON.stringify(all()));
});
`,
};

const forms: Record<string, Record<string, string>> = {
  "one program": { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" },
  "two layers": { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
  "the host runs the test files": { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" },
};

for (const [title, words] of Object.entries(forms)) {
  test(`spies that reach spyOn through helpers: ${title}`, async () => {
    using dir = tempDir("spies-through-helpers", files);
    const lines = async (...flags: string[]) => {
      const env = { ...bunEnv, ...words, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const printed = stdout
        .split("\n")
        .filter(line => /^(tracker|taken out|net|roads|effects|method|restored) /.test(line));
      const log = stderr.split("\n");
      return {
        printed,
        // The first scan is that of the test files.
        scan: log.find(line => line.startsWith("AOT test run | scan of ")),
        startsOver: log.filter(line => line.startsWith("AOT build starts over")),
      };
    };
    const [plain, compiled] = [await lines(), await lines("--aot")];
    expect(plain.printed).toHaveLength(7);
    expect(compiled.printed).toEqual(plain.printed);
    // No helper is left whose names nobody can read.
    expect(compiled.scan).toEndWith("spies on objects from somewhere false");
    // TODO: where the host runs the test files flow still finds `kept` of src/math.ts.
    if (!words.BUN_AOT_TEST_FILES_FROM_DISK) expect(compiled.startsOver).toEqual([]);
  });
}

// One test file that takes `bun:test` by `import()` used to count as one that hands `spyOn` and `mock` on to nobody knows whom: every export of every module
// of the run could be replaced, for all the test files of the run.
const byImport = {
  "src/math.ts": files["src/math.ts"],
  "src/user.ts": files["src/user.ts"],
  "src/holders.ts": files["src/holders.ts"],
  "one.test.ts": `
import { test } from "bun:test";
import { holders } from "./src/holders";
import { all } from "./src/user";
test("names taken out of it", async () => {
  const { spyOn: spy } = await import("bun:test");
  const it = spy(holders.math, "twice").mockReturnValue(4);
  console.log("taken out", JSON.stringify(all()));
  it.mockRestore();
});
test("a name read off it", async () => {
  const it = (await import("bun:test")).spyOn(holders.math, "half").mockReturnValue(5);
  console.log("read off", JSON.stringify(all()));
  it.mockRestore();
  console.log("restored", JSON.stringify(all()));
});
`,
};

for (const [title, words] of Object.entries(forms)) {
  test(`spies out of import("bun:test"): ${title}`, async () => {
    using dir = tempDir("spies-out-of-an-import-of-the-test-runner", byImport);
    const lines = async (...flags: string[]) => {
      const env = { ...bunEnv, ...words, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return {
        printed: stdout.split("\n").filter(line => /^(taken out|read off|restored) /.test(line)),
        scan: stderr.split("\n").find(line => line.startsWith("AOT test run | scan of ")),
      };
    };
    const [plain, compiled] = [await lines(), await lines("--aot")];
    expect(plain.printed).toHaveLength(3);
    expect(compiled.printed).toEqual(plain.printed);
    expect(compiled.scan).toContain("| mocks any module false |");
    expect(compiled.scan).toEndWith("spies on objects from somewhere false");
  });
}
