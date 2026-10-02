import { describe, expect, test } from "bun:test";
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

// A data module exports the value its file parsed to. The loader makes a module from one source never, once, or more
// than once, and reads the value each time.
describe.concurrent("the value of a data module lives as long as its source", () => {
  const object = { default: { v: 1, list: [1, 2, 3] }, v: 1, list: [1, 2, 3] };
  const files = {
    "object.json": { text: `{ "v": 1, "list": [1, 2, 3] }`, namespace: object },
    "object.toml": { text: `v = 1\nlist = [1, 2, 3]\n`, namespace: object },
    "object.yaml": { text: `v: 1\nlist:\n  - 1\n  - 2\n  - 3\n`, namespace: object },
    "array.json": { text: `[1, 2, 3]`, namespace: { __esModule: true, default: [1, 2, 3] } },
  };

  async function run(entry: string) {
    using dir = tempDir("data-module-source", {
      ...Object.fromEntries(Object.entries(files).map(([name, { text }]) => [name, text])),
      "entry.ts": entry,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // An import() that joined a loaded module gets that module's source again when the module is removed before the
  // import() settles. The new macrotask lets go of the first namespace, which held the value until then. `allocate`
  // makes values of the kinds a data file parses to, which take the cell of the file's value if it was freed.
  test.each(Object.keys(files) as (keyof typeof files)[])(
    "%s removed from require.cache while an import() of it is in flight",
    async file => {
      const { stdout, stderr, exitCode } = await run(`
        import { join } from "node:path";
        const path = join(import.meta.dir, ${JSON.stringify(file)});
        const allocate = () =>
          Array.from({ length: 300 }, (_, i) => [{ other: i, object: [i] }, JSON.parse(\`{ "other": \${i}, "object": [\${i}] }\`), [i, i, i]]);
        const load = async () => void (await import(path));

        const seen = new Set();
        for (let round = 0; round < 3; round++) {
          await load();
          await new Promise(resolve => setImmediate(resolve));
          const inFlight = import(path);
          delete require.cache[path];
          Bun.gc(true);
          const others = allocate();
          seen.add(JSON.stringify(await inFlight));
          others.length = 0;
        }
        console.log(JSON.stringify([...seen].map(namespace => JSON.parse(namespace))));
      `);
      expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
        stdout: [files[file].namespace],
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // Each import() of a module that is not loaded yet fetches it, and the loader makes a module from one of the sources.
  test("two import() of a data file at once leave nothing protected", async () => {
    const { stdout, stderr, exitCode } = await run(`
      import { heapStats } from "bun:jsc";
      import { join } from "node:path";
      const protectedBy = {};
      for (const file of ${JSON.stringify(Object.keys(files))}) {
        const path = join(import.meta.dir, file);
        Bun.gc(true);
        const before = heapStats().protectedObjectCount;
        for (let round = 0; round < 10; round++) {
          await Promise.all([import(path), import(path)]);
          delete require.cache[path];
        }
        Bun.gc(true);
        protectedBy[file] = heapStats().protectedObjectCount - before;
      }
      console.log(JSON.stringify(protectedBy));
    `);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: { "object.json": 0, "object.toml": 0, "object.yaml": 0, "array.json": 0 },
      stderr: "",
      exitCode: 0,
    });
  });
});
