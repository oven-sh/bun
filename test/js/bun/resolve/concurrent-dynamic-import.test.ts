import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Two dynamic imports of the same specifier issued before the first async
// transpile/fetch settles must both resolve. Under the new C++ module loader
// each call gets its own embedder fetch promise (the registry entry is created
// only after the first fetch settles), so the loser of that race must still be
// resolved by Bun__onFulfillAsyncModule rather than left pending forever.
test("concurrent dynamic imports of the same module both resolve", async () => {
  using dir = tempDir("concurrent-dyn-import", {
    "shared.ts": `export const heavy = "H";`,
    "modules.ts": `import { heavy } from "./shared";\nexport const lazy = heavy + "-lazy";`,
    "entry.mjs": `
      const first = import("./modules.ts");
      const second = import("./modules.ts");
      const [a, b] = await Promise.all([first, second]);
      if (a.lazy !== "H-lazy" || b.lazy !== "H-lazy") throw new Error("wrong value");
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// The first import() fails at its fetch: the file does not parse. The file is fixed and imported again before that
// failure has settled. The failure belongs to the first import() alone, so a later import() gets the module. JSON is
// read on the calling thread, which fixes the order of the two fetches.
test("an import() that failed to parse does not leave its error on the module a later import() loaded", async () => {
  using dir = tempDir("concurrent-dyn-import-first-fails", {
    "data.json": `{ "value": `,
    "entry.mjs": `
      import { writeFileSync } from "node:fs";
      const path = import.meta.dir + "/data.json";
      const settled = promise => promise.then(module => module.default.value, error => "rejected: " + error.name);

      const first = settled(import(path));
      writeFileSync(path, JSON.stringify({ value: 42 }));
      const second = import(path);

      console.log("first:", await first);
      // Whether the second import() shares the first one's load is not what this tests.
      await second.catch(() => {});
      console.log("later:", await settled(import(path)));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "first: rejected: SyntaxError\nlater: 42\n",
    stderr: "",
    exitCode: 0,
  });
});
