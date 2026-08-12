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

// All of these import()s claim their transpiler-store job before the first one
// is handed back, so they overflow the store's 64-slot hive
// (TRANSPILER_JOB_HIVE_CAP in src/jsc/RuntimeTranspilerStore.rs): the spilled
// jobs are freed, not recycled, when the JS thread takes them back. The ones
// that fail to parse reach that hand-back through the transpiler's early
// return. Every import must settle with its own module's result.
test.concurrent("more concurrent dynamic imports than the transpiler store keeps inline all settle", async () => {
  const count = 96;
  const failsToParse = (i: number) => i % 8 === 7;
  const files: Record<string, string> = {
    "entry.mjs": `
      const settled = await Promise.allSettled(
        Array.from({ length: ${count} }, (_, i) => import("./mod" + i + ".ts")),
      );
      console.log(
        JSON.stringify(
          settled.map(r =>
            r.status === "fulfilled" ? r.value.value : r.reason.name + ":" + r.reason.errors[0].constructor.name,
          ),
        ),
      );
    `,
  };
  for (let i = 0; i < count; i++) {
    files[`mod${i}.ts`] = failsToParse(i)
      ? `export const value: number = ${i}; export {`
      : `export const value = ${i};`;
  }
  using dir = tempDir("many-concurrent-dyn-imports", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual(
    Array.from({ length: count }, (_, i) => (failsToParse(i) ? "AggregateError:BuildMessage" : i)),
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
