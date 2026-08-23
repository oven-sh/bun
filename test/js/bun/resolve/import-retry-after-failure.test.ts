import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// The module loader used to keep the first failure of a module for the whole
// process: a syntax error, a static import that did not resolve, or a plugin
// onLoad that returned unparseable code. Once the file on disk was fixed,
// import() still rejected with the stale error. Node re-reads the file on the
// next import() because it never caches a module that failed to load. Only a
// module whose body threw stays cached (that is the spec, and Node does it too).
test("import() of a module that failed to load retries after the file changes", async () => {
  using dir = tempDir("import-retry", {
    "main.mjs": `
      import fs from "node:fs";
      import { createRequire } from "node:module";
      import { basename } from "node:path";
      const require = createRequire(import.meta.url);

      async function t(label, specifier) {
        try {
          const ns = await import(specifier);
          console.log(label, "OK", ns.v);
        } catch (e) {
          console.log(label, "ERR", e.message.split("\\n")[0]);
        }
      }

      // Own syntax error, then fixed.
      fs.writeFileSync("a.mjs", "export const v == 42;");
      await t("A1", "./a.mjs");
      fs.writeFileSync("a.mjs", "export const v = 42;");
      await t("A2", "./a.mjs");

      // Static dependency missing, then created. The dependency itself was
      // imported in between, so its own entry is a success.
      fs.writeFileSync("b.mjs", 'export { v } from "./c.mjs";');
      await t("B1", "./b.mjs");
      fs.writeFileSync("c.mjs", "export const v = 42;");
      await t("B2c", "./c.mjs");
      await t("B2", "./b.mjs");

      // Static dependency with a syntax error, then fixed. Both the parent and
      // the dependency hold a failed entry.
      fs.writeFileSync("f.mjs", 'export { v } from "./g.mjs";');
      fs.writeFileSync("g.mjs", "export const v == 42;");
      await t("S1", "./f.mjs");
      fs.writeFileSync("g.mjs", "export const v = 42;");
      await t("S2", "./f.mjs");

      // Dependency imported directly first and fails, fixed, then a new parent
      // imports it statically.
      fs.writeFileSync("i.mjs", "export const v == 42;");
      await t("N1", "./i.mjs");
      fs.writeFileSync("i.mjs", "export const v = 42;");
      fs.writeFileSync("h.mjs", 'export { v } from "./i.mjs";');
      await t("N2", "./h.mjs");

      // import() failed, then require() of the fixed file.
      fs.writeFileSync("r.mjs", "export const v == 42;");
      await t("R1", "./r.mjs");
      fs.writeFileSync("r.mjs", "export const v = 42;");
      try {
        console.log("R2", "OK", require("./r.mjs").v);
      } catch (e) {
        console.log("R2", "ERR", e.message.split("\\n")[0]);
      }

      // A plugin onLoad hook that returned unparseable code runs again. The
      // first load of each .virt file fails, every later one succeeds.
      const loads = new Map();
      Bun.plugin({
        name: "retry",
        setup(build) {
          build.onLoad({ filter: /\\.virt$/ }, ({ path }) => {
            const n = (loads.get(basename(path)) ?? 0) + 1;
            loads.set(basename(path), n);
            return { contents: n === 1 ? "export const v == 1;" : "export const v = 42;", loader: "js" };
          });
        },
      });
      fs.writeFileSync("p.virt", "");
      await t("P1", "./p.virt");
      await t("P2", "./p.virt");
      console.log("P loads", loads.get("p.virt"));

      // With a plugin registered every load runs on this thread, so the two
      // loads below settle in the same microtask checkpoint. The failed entry
      // must stay in the registry until the first import() has settled: the
      // loader reports a top-level failure one microtask after it records it,
      // by key, so a fetch registered in between would inherit the stale error.
      // Two import() calls in the same tick, then a retry after both settled.
      fs.writeFileSync("h1.virt", "");
      const h1 = await Promise.allSettled([import("./h1.virt"), import("./h1.virt")]);
      console.log("H1", h1.map(r => (r.status === "fulfilled" ? "OK " + r.value.v : "ERR")).join(" "));
      await t("H1b", "./h1.virt");
      console.log("H1 loads", loads.get("h1.virt"));
      // An import() issued from a microtask queued right after the failing one.
      fs.writeFileSync("h2.virt", "");
      const h2 = await Promise.allSettled([import("./h2.virt"), Promise.resolve().then(() => import("./h2.virt"))]);
      console.log("H2", h2.map(r => (r.status === "fulfilled" ? "OK " + r.value.v : "ERR")).join(" "));
      await t("H2b", "./h2.virt");
      console.log("H2 loads", loads.get("h2.virt"));

      // A module whose body threw stays cached even after the file changes.
      fs.writeFileSync("e.mjs", 'throw new Error("boom"); export const v = 1;');
      await t("E1", "./e.mjs");
      fs.writeFileSync("e.mjs", "export const v = 42;");
      await t("E2", "./e.mjs");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout, String(dir))).toMatchInlineSnapshot(`
    "A1 ERR 2 errors building "<dir>/a.mjs"
    A2 OK 42
    B1 ERR Cannot find module './c.mjs' imported from <dir>/b.mjs
    B2c OK 42
    B2 OK 42
    S1 ERR 2 errors building "<dir>/g.mjs"
    S2 OK 42
    N1 ERR 2 errors building "<dir>/i.mjs"
    N2 OK 42
    R1 ERR 2 errors building "<dir>/r.mjs"
    R2 OK 42
    P1 ERR 2 errors building "<dir>/p.virt"
    P2 OK 42
    P loads 2
    H1 ERR ERR
    H1b OK 42
    H1 loads 3
    H2 ERR ERR
    H2b OK 42
    H2 loads 2
    E1 ERR boom
    E2 ERR boom"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
