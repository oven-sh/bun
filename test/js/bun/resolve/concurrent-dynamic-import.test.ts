import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Two dynamic imports of the same specifier issued before the first async
// transpile/fetch settles must both resolve, sharing one in-flight fetch.
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

// JSC only registers a module registry entry once the first embedder fetch
// settles, so every importer that arrives before then used to start its own
// fetch. The loader (a plugin's onLoad, or the transpiler) must run once per
// module, not once per importer.
const pluginPrelude = `
  globalThis.counts = { resolve: 0, load: 0 };
  Bun.plugin({
    name: "virt",
    setup(build) {
      build.onResolve({ filter: /.*/, namespace: "virt" }, args => {
        globalThis.counts.resolve++;
        return { path: args.path, namespace: "virt" };
      });
      build.onLoad({ filter: /.*/, namespace: "virt" }, async args => {
        globalThis.counts.load++;
        await Promise.resolve();
        return { contents: "export const n = " + globalThis.counts.load + ";", loader: "js" };
      });
    },
  });
`;

async function runFixture(files: Record<string, string>, args = ["entry.mjs"]) {
  using dir = tempDir("concurrent-dyn-import-plugin", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("concurrent dynamic imports of a plugin-provided specifier run onLoad once", async () => {
  const { stdout, stderr, exitCode } = await runFixture({
    "entry.mjs": `
      ${pluginPrelude}
      const mods = await Promise.all([import("virt:x"), import("virt:x"), import("virt:x")]);
      console.log(JSON.stringify({
        load: globalThis.counts.load,
        n: mods.map(m => m.n),
        sameIdentity: mods[0] === mods[1] && mods[1] === mods[2],
      }));
    `,
  });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ load: 1, n: [1, 1, 1], sameIdentity: true });
});

test("coalescing an in-flight fetch is per specifier, and survives a later import", async () => {
  const { stdout, stderr, exitCode } = await runFixture({
    "entry.mjs": `
      ${pluginPrelude}
      await Promise.all([import("virt:a"), import("virt:a"), import("virt:b"), import("virt:b")]);
      const afterConcurrent = globalThis.counts.load;
      // Already in the registry: no fetch, so no additional load.
      await import("virt:a");
      console.log(JSON.stringify({ afterConcurrent, afterReimport: globalThis.counts.load }));
    `,
  });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ afterConcurrent: 2, afterReimport: 2 });
});

test("a plugin-provided specifier that fails to load rejects every concurrent importer", async () => {
  const { stdout, stderr, exitCode } = await runFixture({
    "entry.mjs": `
      let load = 0;
      Bun.plugin({
        name: "boom",
        setup(build) {
          build.onResolve({ filter: /.*/, namespace: "boom" }, args => ({ path: args.path, namespace: "boom" }));
          build.onLoad({ filter: /.*/, namespace: "boom" }, async () => {
            load++;
            throw new Error("nope");
          });
        },
      });
      const results = await Promise.allSettled([import("boom:x"), import("boom:x"), import("boom:x")]);
      console.log(JSON.stringify({
        load,
        statuses: results.map(r => r.status),
        messages: results.map(r => r.reason.message),
      }));
    `,
  });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({
    load: 1,
    statuses: ["rejected", "rejected", "rejected"],
    messages: ["nope", "nope", "nope"],
  });
});

test("concurrent dynamic imports of a file run its onLoad plugin once", async () => {
  const { stdout, stderr, exitCode } = await runFixture({
    "mod.mjs": `export const v = "from disk";`,
    "entry.mjs": `
      let load = 0;
      Bun.plugin({
        name: "file-counter",
        setup(build) {
          build.onLoad({ filter: /mod\\.mjs$/ }, () => {
            load++;
            return { contents: 'export const v = "from plugin";', loader: "js" };
          });
        },
      });
      const mods = await Promise.all([import("./mod.mjs"), import("./mod.mjs"), import("./mod.mjs")]);
      console.log(JSON.stringify({ load, v: mods.map(m => m.v) }));
    `,
  });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ load: 1, v: ["from plugin", "from plugin", "from plugin"] });
});

// The in-flight fetch is keyed on the same triple as the module registry, so
// these two imports of one path stay separate modules with different sources.
test("concurrent dynamic imports of one path with different type attributes are not coalesced", async () => {
  const { stdout, stderr, exitCode } = await runFixture({
    "data.json": `{"a":1}`,
    "entry.mjs": `
      const [plain, text] = await Promise.all([
        import("./data.json"),
        import("./data.json", { with: { type: "text" } }),
      ]);
      console.log(JSON.stringify({ plain: plain.default, text: text.default }));
    `,
  });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ plain: { a: 1 }, text: `{"a":1}` });
});

// Attributes without a `type` key are their own registry entry even though the
// type attribute string is empty for both, so the two fetches must stay apart.
test("concurrent dynamic imports of one path with and without import attributes stay separate modules", async () => {
  const { stdout, stderr, exitCode } = await runFixture({
    "mod.mjs": `export const v = 1;`,
    "entry.mjs": `
      let load = 0;
      Bun.plugin({
        name: "file-counter",
        setup(build) {
          build.onLoad({ filter: /mod\\.mjs$/ }, () => {
            load++;
            return { contents: "export const v = 1;", loader: "js" };
          });
        },
      });
      const [plain, attributed] = await Promise.all([
        import("./mod.mjs"),
        import("./mod.mjs", { with: { unknown: "x" } }),
      ]);
      console.log(JSON.stringify({ load, sameModule: plain === attributed, v: [plain.v, attributed.v] }));
    `,
  });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ load: 2, sameModule: false, v: [1, 1] });
});

// require(esm) forces a synchronous fetch of a key whose async fetch may still
// be in flight; it must not get handed the pending promise.
test("require(esm) racing a dynamic import of the same module still resolves synchronously", async () => {
  const { stdout, stderr, exitCode } = await runFixture(
    {
      "esm.mjs": `export const v = "esm";`,
      "entry.cjs": `
        const pending = import("./esm.mjs");
        const required = require("./esm.mjs");
        pending.then(imported => {
          console.log(JSON.stringify({ required: required.v, imported: imported.v }));
        });
      `,
    },
    ["entry.cjs"],
  );
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ required: "esm", imported: "esm" });
});

// A settled fetch must be dropped again, otherwise mock.module() (which wipes
// the module registry entry) would be defeated by the coalescing cache.
test("a settled fetch stops being shared once the module registry owns it", async () => {
  const { stdout, stderr, exitCode } = await runFixture(
    {
      "mod.mjs": `export const v = "real";`,
      "invalidate.test.ts": `
        import { expect, mock, test } from "bun:test";
        let loads = 0;
        Bun.plugin({
          name: "counter",
          setup(build) {
            build.onLoad({ filter: /mod\\.mjs$/ }, () => {
              loads++;
              return { contents: 'export const v = "real";', loader: "js" };
            });
          },
        });
        test("mock.module after a settled fetch wins", async () => {
          expect((await import("./mod.mjs")).v).toBe("real");
          expect(loads).toBe(1);
          mock.module("./mod.mjs", () => ({ v: "mocked" }));
          expect((await import("./mod.mjs")).v).toBe("mocked");
          expect(loads).toBe(1);
        });
      `,
    },
    ["test", "invalidate.test.ts"],
  );
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect({ stdout, exitCode }).toEqual({ stdout: expect.stringContaining("bun test"), exitCode: 0 });
});
