import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "reset-next-file" }`,
  "state.ts": `import { platform } from "node:os";
(globalThis.ran ??= []).push("state");
export const host = platform;
export const box = { n: 0 };
export const bump = () => ++box.n;`,
  "user.ts": `import { bump } from "./state";
export const use = () => bump();`,
  "index.ts": `export { use } from "./user";`,
  "late.ts": `import { bump } from "./state";
export const late = () => bump();`,
  "a.test.ts": `import { test, vi } from "bun:test";
import { use } from "./index";
test("a", async () => {
  vi.resetModules();
  console.log("OUT a", use(), (await import("./user")).use(), globalThis.ran.join());
});`,
  "b.test.ts": `import { test } from "bun:test";
import { box, bump } from "./state";
import { late } from "./late";
test("b", () => console.log("OUT b", bump(), late(), box.n, globalThis.ran.join()));`,
  "wants-package.ts": `import gone from "not-installed";
export default gone;`,
  "wants-file.ts": `import gone from "./gone";
export default gone;`,
  "c.test.ts": `import { test, vi } from "bun:test";
test.each([() => import("./wants-package"), () => import("./wants-file")])("c", async load => {
  for (const turn of [1, 2, 3]) {
    const error = await load().catch(error => error);
    console.log("OUT c", turn, error.constructor.name, error.message.replace(/ imported from .*/, ""));
    vi.resetModules();
  }
});`,
};
const missing = (words: string) => [1, 2, 3].map(turn => `OUT c ${turn} ResolveMessage Cannot find ${words}`);

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("the next test file gets what the reset file loaded, and a failed import fails again in the same words", async () => {
  using folder = tempDir("aot-reset-next-file", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: [
      "OUT a 1 1 state,state",
      "OUT b 2 3 3 state,state",
      ...missing("package 'not-installed'"),
      ...missing("module './gone'"),
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 240_000);
