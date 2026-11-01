import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

// `vi.useFakeTimers()` of "vitest" fakes `performance` too, with an object that a function of Bun's own library makes. That function is the runner's: no build compiles it with the files under test.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "clock.js": `
    export const later = (ms, f) => setTimeout(f, ms);
    export const now = () => Date.now();
    const key = ["perform", "ance"].join("");
    export const byKeyOfTheRun = () => globalThis[key];
    export const byName = since => Math.floor(performance.now() - since) + " " + JSON.stringify(performance.mark("m"));`,
  "fakes.test.js": `
    import { test, vi } from "vitest";
    import { byKeyOfTheRun, byName, later, now } from "./clock.js";
    test("fakes", () => {
      vi.useFakeTimers();
      let hit = 0;
      later(1000, () => hit++);
      const [before, since] = [now(), byKeyOfTheRun().now()];
      vi.advanceTimersByTime(5000);
      console.log("| timers:", hit, now() - before, vi.isFakeTimers());
      console.log("| by a key of the run:", byKeyOfTheRun().now() - since, JSON.stringify(byKeyOfTheRun().mark("m")), JSON.stringify(byKeyOfTheRun().getEntries()));
      console.log("| by name:", byName(since));
      vi.useRealTimers();
      console.log("| real again:", vi.isFakeTimers(), typeof byKeyOfTheRun().mark("m").detail);
    });`,
  "taken-out.test.js": `
    import { test, vi } from "vitest";
    import { byKeyOfTheRun } from "./clock.js";
    test("taken out of vi", () => {
      const use = vi.useFakeTimers;
      use();
      console.log("| taken out:", vi.isFakeTimers());
      console.log("| by a key of the run, taken out:", JSON.stringify(byKeyOfTheRun().measure("m")));
      vi.useRealTimers();
    });`,
};

async function report(directory: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  const printed = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| "));
  if (exitCode !== 0) console.error(stderr);
  return { printed: printed.sort(), exitCode };
}

let directory: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof report>>;
beforeAll(async () => {
  directory = tempDir("vitest-fake-timers", files);
  plain = await report(String(directory), []);
});
afterAll(() => directory?.[Symbol.dispose]());

test("the fake of performance is made and answers: plain Bun", () => {
  const mark = `{"name":"m","entryType":"mark","startTime":0,"duration":0}`;
  expect(plain).toEqual({
    printed: [
      "| by a key of the run, taken out: " + `{"name":"m","entryType":"measure","startTime":0,"duration":100}`,
      "| by a key of the run: 5000 " + mark + " []",
      `| by name: 5000 ${mark}`,
      "| real again: false object",
      "| taken out: true",
      "| timers: 1 5000 true",
    ],
    exitCode: 0,
  });
});

// Compiled code went on reading the real `performance` behind the fake, by name and by a key: the name was locked, so the fake was never put on the global object.
test.each([
  ["as the run builds itself", undefined],
  ["two layers", "TestRunLayers:2"],
])("the fake of performance is made and answers: %s", async (_, words) => {
  expect(await report(String(directory), ["--aot"], words)).toEqual(plain);
});
