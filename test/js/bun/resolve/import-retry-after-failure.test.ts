import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// A load that fails before the module ran is not the answer for the next load of that module: a
// syntax error, a static import that does not resolve or does not parse, a plugin onLoad that
// returned unparseable code. Once the file is fixed, the module and every module that imports it
// load again, as in Node, which caches a module only after it and its imports are loaded. A module
// whose body threw, or that did not link, stays as it is (the spec, and Node).
// A load that failed also leaves a concurrent load of the same module alone.
test("a module whose load failed before it ran is loaded again by the next import", async () => {
  using dir = tempDir("import-retry", {
    // runMain resolves with no referrer and does not re-read a directory
    // listed before the file was written, so these exist before bun starts.
    "h3.virt": "",
    "h5.mjs": "export const v = 42;",
    "h6.virt": "",
    "d.json": '{"v":42}',
    "main.mjs": `
      import fs from "node:fs";
      import { createRequire } from "node:module";
      import { basename } from "node:path";
      const require = createRequire(import.meta.url);
      globalThis.ran = [];
      const ranTimes = name => globalThis.ran.filter(entry => entry === name).length;

      const message = e => String(e?.message ?? e).split("\\n")[0];
      async function t(label, specifier, load = s => import(s)) {
        try {
          const ns = await load(specifier);
          console.log(label, "OK", ns.v);
        } catch (e) {
          console.log(label, "ERR", message(e));
        }
      }
      function r(label, specifier) {
        try {
          console.log(label, "OK", require(specifier).v);
        } catch (e) {
          console.log(label, "ERR", message(e));
        }
      }
      const settled = results => results.map(r => (r.status === "fulfilled" ? "OK " + r.value.v : "ERR")).join(" ");

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

      // Static dependency with a syntax error, then fixed. Nothing else
      // imported the dependency in between.
      fs.writeFileSync("f.mjs", 'export { v } from "./g.mjs";');
      fs.writeFileSync("g.mjs", "export const v == 42;");
      await t("S1", "./f.mjs");
      fs.writeFileSync("g.mjs", "export const v = 42;");
      await t("S2", "./f.mjs");

      // A dependency that failed below one importer is loaded again by a
      // static import of another importer, and then by the first one.
      fs.writeFileSync("t1.mjs", 'export { v } from "./t0.mjs";');
      fs.writeFileSync("t0.mjs", "export const v == 42;");
      await t("T1", "./t1.mjs");
      fs.writeFileSync("t0.mjs", 'globalThis.ran.push("t0"); export const v = 42;');
      fs.writeFileSync("t2.mjs", 'export { v } from "./t0.mjs";');
      await t("T2", "./t2.mjs");
      await t("T3", "./t1.mjs");
      console.log("T ran", ranTimes("t0"));

      // Two importers above the missing module: both are loaded again.
      fs.writeFileSync("u2.mjs", 'export { v } from "./u1.mjs";');
      fs.writeFileSync("u1.mjs", 'export { v } from "./u0.mjs";');
      await t("U1", "./u2.mjs");
      fs.writeFileSync("u0.mjs", "export const v = 42;");
      await t("U2", "./u2.mjs");

      // The importer itself is read again: here the import that failed is
      // removed from it.
      fs.writeFileSync("w.mjs", 'export { v } from "./w-typo.mjs";');
      await t("W1", "./w.mjs");
      fs.writeFileSync("w.mjs", "export const v = 42;");
      await t("W2", "./w.mjs");

      // An import cycle with a missing module below it.
      fs.writeFileSync("ca.mjs", 'import { b } from "./cb.mjs"; globalThis.ran.push("ca"); export const a = 40; export const v = a + b;');
      fs.writeFileSync("cb.mjs", 'import "./ca.mjs"; import { two } from "./cc.mjs"; globalThis.ran.push("cb"); export const b = two;');
      await t("C1", "./ca.mjs");
      fs.writeFileSync("cc.mjs", "export const two = 2;");
      await t("C2", "./ca.mjs");
      console.log("C ran", ranTimes("ca"), ranTimes("cb"));

      // Two import() calls of one importer overlap while its dependency fails.
      fs.writeFileSync("o.mjs", 'export { v } from "./o0.mjs";');
      console.log("O1", settled(await Promise.allSettled([import("./o.mjs"), import("./o.mjs")])));
      fs.writeFileSync("o0.mjs", 'globalThis.ran.push("o0"); export const v = 42;');
      const o2 = await Promise.allSettled([import("./o.mjs"), import("./o.mjs")]);
      console.log("O2", settled(o2), o2[0].value === o2[1].value);
      console.log("O ran", ranTimes("o0"));

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
      r("R2", "./r.mjs");

      // import() failed on a dependency, then require() of the importer.
      fs.writeFileSync("q.mjs", 'export { v } from "./q0.mjs";');
      await t("Q1", "./q.mjs");
      fs.writeFileSync("q0.mjs", "export const v = 42;");
      r("Q2", "./q.mjs");

      // require() failed on a dependency, then require() and import() of the importer.
      fs.writeFileSync("x.mjs", 'export { v } from "./x0.mjs";');
      r("X1", "./x.mjs");
      fs.writeFileSync("x0.mjs", 'globalThis.ran.push("x0"); export const v = 42;');
      r("X2", "./x.mjs");
      await t("X3", "./x.mjs");
      console.log("X ran", ranTimes("x0"));

      // require() failed on a dependency that does not parse, then require()
      // of the importer, and import() of the dependency.
      fs.writeFileSync("y.mjs", 'export { v } from "./y0.mjs";');
      fs.writeFileSync("y0.mjs", "export const v == 42;");
      r("Y1", "./y.mjs");
      fs.writeFileSync("y0.mjs", "export const v = 42;");
      r("Y2", "./y.mjs");
      await t("Y3", "./y0.mjs");

      // A Bun.ModuleGraph has a registry of its own, with the same rule.
      {
        const graph = new Bun.ModuleGraph();
        fs.writeFileSync("m.mjs", 'export { v } from "./m0.mjs";');
        await t("M1", "./m.mjs", s => graph.import(s));
        fs.writeFileSync("m0.mjs", "export const v = 42;");
        await t("M2", "./m.mjs", s => graph.import(s));
        graph.dispose();
      }

      // A plugin onLoad hook that returned unparseable code runs again. The
      // first load of each .virt file fails, every later one succeeds. k.virt
      // is good on its first load, bad on loads 2 to 8, then good again: a
      // file caught mid-save by some of the callers.
      const loads = new Map();
      Bun.plugin({
        name: "retry",
        setup(build) {
          build.onLoad({ filter: /\\.virt$/ }, ({ path }) => {
            const name = basename(path);
            const n = (loads.get(name) ?? 0) + 1;
            loads.set(name, n);
            const bad = name === "k.virt" ? n > 1 && n <= 8 : n === 1;
            return { contents: bad ? "export const v == 1;" : "export const v = 42;", loader: "js" };
          });
        },
      });
      fs.writeFileSync("p.virt", "");
      await t("P1", "./p.virt");
      await t("P2", "./p.virt");
      console.log("P loads", loads.get("p.virt"));

      // An onLoad hook that rejects with the error of another module does not
      // leave that error on its own module: the hook runs again for the next load.
      fs.writeFileSync("g0.mjs", 'throw new Error("thrown below onLoad");');
      fs.writeFileSync("g.late", "");
      let lateLoads = 0;
      Bun.plugin({
        name: "late",
        setup(build) {
          build.onLoad({ filter: /\\.late$/ }, async () => {
            if (++lateLoads === 1) await import("./g0.mjs");
            return { contents: "export const v = 42;", loader: "js" };
          });
        },
      });
      await t("G1", "./g.late");
      await t("G2", "./g.late");
      console.log("G loads", lateLoads);

      // With a plugin registered every load runs on this thread, so the loads
      // below settle in the same microtask checkpoint. A load that failed
      // must not leave its error on the module that an overlapping load of
      // the same key goes on to load.
      // Two import() calls in the same tick, then another one after both settled.
      fs.writeFileSync("h1.virt", "");
      console.log("H1", settled(await Promise.allSettled([import("./h1.virt"), import("./h1.virt")])));
      await t("H1b", "./h1.virt");
      console.log("H1 loads", loads.get("h1.virt"));
      // The same for a load that succeeds: both get the one namespace.
      fs.writeFileSync("j.mjs", "export const v = 42;");
      const j = await Promise.all([import("./j.mjs"), import("./j.mjs")]);
      console.log("J", j[0].v, j[1].v, j[0] === j[1]);
      // Eight callers, of which the first one's load is good: the seven that
      // failed leave the module of the first in place.
      fs.writeFileSync("k.virt", "");
      const k = await Promise.allSettled(Array.from({ length: 8 }, () => import("./k.virt")));
      console.log("K", k.map(r => (r.status === "fulfilled" ? "OK" : "ERR")).join(" "));
      await t("Kb", "./k.virt");
      console.log("K same", await import("./k.virt").then(ns => ns === k[0].value, () => "ERR"));
      // An import() issued from a microtask queued right after the failing one.
      fs.writeFileSync("h2.virt", "");
      console.log("H2", settled(await Promise.allSettled([import("./h2.virt"), Promise.resolve().then(() => import("./h2.virt"))])));
      await t("H2b", "./h2.virt");
      console.log("H2 loads", loads.get("h2.virt"));
      // Module.runMain starts the same kind of top-level load as import().
      require("module").runMain("./h3.virt");
      const h3 = await Promise.resolve()
        .then(() => import("./h3.virt"))
        .then(ns => "OK " + ns.v, () => "ERR");
      console.log("H3", h3);
      await t("H3b", "./h3.virt");
      console.log("H3 loads", loads.get("h3.virt"));
      // An import() that overlaps a runMain load gets the namespace, not runMain's
      // evaluation result.
      require("module").runMain("./h5.mjs");
      const h5 = await Promise.resolve()
        .then(() => import("./h5.mjs"))
        .then(ns => "OK " + ns.v, () => "ERR");
      console.log("H5", h5);
      // Two runMain calls of one key, the first of which fails.
      require("module").runMain("./h6.virt");
      require("module").runMain("./h6.virt");
      const h6 = await Promise.resolve()
        .then(() => import("./h6.virt"))
        .then(ns => "OK " + ns.v, () => "ERR");
      console.log("H6", h6);
      await t("H6b", "./h6.virt");
      console.log("H6 loads", loads.get("h6.virt"));
      // Loads are keyed by module type too.
      const d = await Promise.all([import("./d.json"), import("./d.json", { with: { type: "text" } })]);
      console.log("D", typeof d[0].default, d[0].default.v, typeof d[1].default, JSON.parse(d[1].default).v);

      // A module whose body threw stays cached even after the file changes,
      // and so does a module that imports it.
      fs.writeFileSync("e.mjs", 'globalThis.ran.push("e"); throw new Error("boom"); export const v = 1;');
      await t("E1", "./e.mjs");
      fs.writeFileSync("e.mjs", "export const v = 42;");
      await t("E2", "./e.mjs");
      fs.writeFileSync("e2.mjs", 'import "./e0.mjs"; globalThis.ran.push("e2"); export const v = 42;');
      fs.writeFileSync("e0.mjs", 'globalThis.ran.push("e0"); throw new Error("boom below"); export const v = 1;');
      await t("E3", "./e2.mjs");
      fs.writeFileSync("e0.mjs", "export const v = 42;");
      await t("E4", "./e2.mjs");
      await t("E5", "./e0.mjs");
      console.log("E ran", ranTimes("e"), ranTimes("e0"), ranTimes("e2"));

      // A module that did not link stays as it is: what it imports is loaded,
      // and may have run for another importer.
      fs.writeFileSync("l.mjs", 'import { nope } from "./l0.mjs"; export const v = nope;');
      fs.writeFileSync("l0.mjs", "export const v = 42;");
      await t("L1", "./l.mjs");
      fs.writeFileSync("l0.mjs", "export const nope = 42;");
      await t("L2", "./l.mjs");

      // The body of a CommonJS module that threw does not run again either,
      // below an ES module or imported on its own.
      fs.writeFileSync("cj.mjs", 'import "./cj0.cjs"; globalThis.ran.push("cj"); export const v = 42;');
      fs.writeFileSync("cj0.cjs", 'globalThis.ran.push("cj0"); throw new Error("cjs boom");');
      await t("CJ1", "./cj.mjs");
      fs.writeFileSync("cj0.cjs", 'globalThis.ran.push("cj0"); module.exports = { v: 42 };');
      await t("CJ2", "./cj.mjs");
      await t("CJ3", "./cj0.cjs");
      console.log("CJ ran", ranTimes("cj0"), ranTimes("cj"));

      // A JSON module that does not parse, below an ES module, then fixed.
      fs.writeFileSync("j1.mjs", 'import j from "./j0.json"; export const v = j.v;');
      fs.writeFileSync("j0.json", '{"v": ');
      await t("JS1", "./j1.mjs");
      fs.writeFileSync("j0.json", '{"v": 42}');
      await t("JS2", "./j1.mjs");

      // A module with top-level await whose import is missing, then written.
      fs.writeFileSync("ta.mjs", 'import { w } from "./ta0.mjs"; export const v = await Promise.resolve(w);');
      await t("TA1", "./ta.mjs");
      fs.writeFileSync("ta0.mjs", "export const w = 42;");
      await t("TA2", "./ta.mjs");
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
    T1 ERR 2 errors building "<dir>/t0.mjs"
    T2 OK 42
    T3 OK 42
    T ran 1
    U1 ERR Cannot find module './u0.mjs' imported from <dir>/u1.mjs
    U2 OK 42
    W1 ERR Cannot find module './w-typo.mjs' imported from <dir>/w.mjs
    W2 OK 42
    C1 ERR Cannot find module './cc.mjs' imported from <dir>/cb.mjs
    C2 OK 42
    C ran 1 1
    O1 ERR ERR
    O2 OK 42 OK 42 true
    O ran 1
    N1 ERR 2 errors building "<dir>/i.mjs"
    N2 OK 42
    R1 ERR 2 errors building "<dir>/r.mjs"
    R2 OK 42
    Q1 ERR Cannot find module './q0.mjs' imported from <dir>/q.mjs
    Q2 OK 42
    X1 ERR Cannot find module './x0.mjs' imported from <dir>/x.mjs
    X2 OK 42
    X3 OK 42
    X ran 1
    Y1 ERR 2 errors building "<dir>/y0.mjs"
    Y2 OK 42
    Y3 OK 42
    M1 ERR Cannot find module './m0.mjs' imported from <dir>/m.mjs
    M2 OK 42
    P1 ERR 2 errors building "<dir>/p.virt"
    P2 OK 42
    P loads 2
    G1 ERR thrown below onLoad
    G2 OK 42
    G loads 2
    H1 ERR OK 42
    H1b OK 42
    H1 loads 2
    J 42 42 true
    K OK ERR ERR ERR ERR ERR ERR ERR
    Kb OK 42
    K same true
    H2 ERR OK 42
    H2b OK 42
    H2 loads 2
    H3 OK 42
    H3b OK 42
    H3 loads 2
    H5 OK 42
    H6 OK 42
    H6b OK 42
    H6 loads 2
    D object 42 string 42
    E1 ERR boom
    E2 ERR boom
    E3 ERR boom below
    E4 ERR boom below
    E5 ERR boom below
    E ran 1 1 0
    L1 ERR Export named 'nope' not found in module '<dir>/l0.mjs'.
    L2 ERR Export named 'nope' not found in module '<dir>/l0.mjs'.
    CJ1 ERR cjs boom
    CJ2 ERR cjs boom
    CJ3 ERR cjs boom
    CJ ran 1 0
    JS1 ERR JSON Parse error: Unexpected EOF
    JS2 OK 42
    TA1 ERR Cannot find module './ta0.mjs' imported from <dir>/ta.mjs
    TA2 OK 42"
  `);
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
});

// A graph takes up a module that another load is still loading. Here a second load reaches such a
// module at every step of that module's failing load: a load of an importer, or of the module
// itself. The module's dependency loads on its second fetch. Whatever the order, no load may go on
// with a module that has left the registry, and no load may leave its own failure on a module that
// another load goes on to load: afterwards the importer and the module load, and each has run once.
test.each([
  ["import", "importer"],
  ["require", "importer"],
  ["import", "middle"],
  ["require", "middle"],
])("a second load that reaches a module while its load fails: %s of the %s", async (how, what) => {
  using dir = tempDir("import-retry-order", {
    "main.mjs": `
      import fs from "node:fs";
      import { createRequire } from "node:module";
      import { basename } from "node:path";
      const require = createRequire(import.meta.url);
      globalThis.ran = [];
      const loads = new Map();
      Bun.plugin({
        name: "order",
        setup(build) {
          build.onLoad({ filter: /\\.virt$/ }, ({ path }) => {
            const name = basename(path, ".virt");
            const n = (loads.get(name) ?? 0) + 1;
            loads.set(name, n);
            const [kind, order] = name.split("-");
            const ran = \`globalThis.ran.push("\${name}");\`;
            if (kind === "importer") return { contents: \`import "./middle-\${order}.virt"; \${ran}\`, loader: "js" };
            if (kind === "middle") return { contents: \`import "./leaf-\${order}.virt"; \${ran}\`, loader: "js" };
            return { contents: n === 1 ? "export const v == 1;" : ran, loader: "js" };
          });
        },
      });
      const afterJobs = (count, callback) => {
        let job = Promise.resolve();
        while (count--) job = job.then(() => {});
        return job.then(callback);
      };
      const settled = promise => promise.then(() => "OK", () => "ERR");
      const wrong = [];
      for (let order = 0; order < 15; order++) {
        // The resolver wants the files to exist. The plugin supplies what is in them.
        for (const kind of ["importer", "middle", "leaf"]) fs.writeFileSync(\`\${kind}-\${order}.virt\`, "");
        const first = [settled(import(\`./middle-\${order}.virt\`))];
        await afterJobs(order, () => {
          if (${JSON.stringify(how)} === "import") first.push(settled(import(\`./${what}-\${order}.virt\`)));
          else try { require(\`./${what}-\${order}.virt\`); } catch {}
        });
        await Promise.all(first);
        const again = [await settled(import(\`./importer-\${order}.virt\`)), await settled(import(\`./middle-\${order}.virt\`))];
        const ran = ["importer", "middle", "leaf"].map(kind => globalThis.ran.filter(name => name === \`\${kind}-\${order}\`).length);
        if (again.join() !== "OK,OK" || ran.join() !== "1,1,1") wrong.push({ order, again, ran });
      }
      console.log(JSON.stringify(wrong));
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

  expect(stdout.trim()).toBe("[]");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
});
