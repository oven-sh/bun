import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Two dynamic imports of the same specifier issued before the first async
// transpile/fetch settles must both resolve. Under the new C++ module loader
// each call gets its own embedder fetch promise (the registry entry is created
// only after the first fetch settles), so the loser of that race must still be
// resolved by Bun__onFulfillAsyncModule rather than left pending forever.
test.concurrent("concurrent dynamic imports of the same module both resolve", async () => {
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

// A top-level import() whose transpile fails rejects with a BuildMessage,
// which is not an ErrorInstance. Before oven-sh/WebKit#262 the loader recorded
// that rejection as an evaluation error on a registry entry that had no fetch,
// module, or load promise, and the next module that imported the same file
// statically waited forever on a promise nothing settled.
test.concurrent("a failed dynamic import does not strand later static importers of the same file", async () => {
  using dir = tempDir("dyn-import-fetch-error", {
    // Exactly one parser error so the rejection value is a BuildMessage
    // rather than an AggregateError (which is an ErrorInstance).
    "bad.ts": `import {\n`,
    "other.ts": `import "./bad.ts";\nconsole.log("other loaded");\n`,
    "entry.mjs": `
      const d = import.meta.dir;
      const names = [];
      try { await import(d + "/bad.ts"); names.push("resolved"); } catch (e) { names.push(e?.name); }
      try { await import(d + "/other.ts"); names.push("resolved"); } catch (e) { names.push(e?.name); }
      console.log(JSON.stringify(names));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // On a regression the second import() never settles, so the child never
  // exits and this test times out.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: JSON.stringify(["BuildMessage", "BuildMessage"]),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
