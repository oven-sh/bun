import { test, expect } from "bun:test";
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
