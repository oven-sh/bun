import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// When an ES module imports a mix of ESM and CJS dependencies, the CJS bodies
// must evaluate at the same point in the module-graph DFS as ESM siblings.
// Previously Bun executed CJS bodies inside JSModuleLoader::makeModule() (the
// fetch-settled microtask), which runs in off-thread-transpile completion order
// before any ESM sibling's evaluate(), so `A B C D` came out as `D B A C` or
// `B D A C` run-to-run.
test("ESM-imported CJS modules evaluate in source order alongside ESM siblings", async () => {
  using dir = tempDir("cjs-esm-eval-order", {
    "a.mjs": `console.log("A");`,
    "b.cjs": `console.log("B"); module.exports = 1;`,
    "c.mjs": `console.log("C");`,
    "d.cjs": `console.log("D"); module.exports = 1;`,
    "entry.mjs": `import "./a.mjs";\nimport "./b.cjs";\nimport "./c.mjs";\nimport "./d.cjs";\nconsole.log("ENTRY");\n`,
  });

  const outputs = new Set<string>();
  // Multiple runs exercise the off-thread transpile pool scheduling that
  // previously made B/D swap. Every run must produce the same sequence.
  for (let i = 0; i < 8; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    outputs.add(stdout);
    expect(exitCode).toBe(0);
  }
  expect([...outputs]).toEqual(["A\nB\nC\nD\nENTRY\n"]);
});

test("ESM-imported CJS named exports are bound statically and evaluate in source order", async () => {
  using dir = tempDir("cjs-esm-named", {
    "register.mjs": `globalThis.__order = ["register"];`,
    "lib.cjs": `
      globalThis.__order.push("lib");
      exports.alpha = 1;
      module.exports.beta = 2;
      Object.defineProperty(exports, "gamma", { value: 3, enumerable: true });
    `,
    "entry.mjs": `
      import "./register.mjs";
      import lib, { alpha, beta, gamma } from "./lib.cjs";
      console.log(JSON.stringify({ order: globalThis.__order, alpha, beta, gamma, lib }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    order: ["register", "lib"],
    alpha: 1,
    beta: 2,
    gamma: 3,
    lib: { alpha: 1, beta: 2, gamma: 3 },
  });
  expect(exitCode).toBe(0);
});

test("__exportStar/__export re-exports surface as named exports", async () => {
  using dir = tempDir("cjs-esm-reexport", {
    "inner.cjs": `exports.inner = "inner";`,
    "outer.cjs": `
      var tslib = { __exportStar: (m, e) => { for (var k in m) e[k] = m[k]; } };
      Object.defineProperty(exports, "__esModule", { value: true });
      tslib.__exportStar(require("./inner.cjs"), exports);
      Object.defineProperty(exports, "direct", { enumerable: true, get: () => "direct" });
    `,
    "entry.mjs": `
      import { inner, direct } from "./outer.cjs";
      console.log(JSON.stringify({ inner, direct }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ inner: "inner", direct: "direct" });
  expect(exitCode).toBe(0);
});

test("module.exports = require(...) surfaces the target's named exports", async () => {
  // A `module.exports = require("x")` file has no statically-enumerable named
  // exports of its own, so it takes the synthetic-provider path (the body runs
  // at makeModule() and all runtime properties become named exports). These are
  // pass-through shims with no side effects, so the ordering fix is not needed
  // for them.
  using dir = tempDir("cjs-esm-reexport-assign", {
    "impl.cjs": `exports.marker = "impl";`,
    "entry-point.cjs": `
      if (process.env.UNUSED) {
        module.exports = require("./impl.cjs");
      } else {
        module.exports = require("./impl.cjs");
      }
    `,
    "entry.mjs": `
      import { marker } from "./entry-point.cjs";
      console.log(marker);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("impl\n");
  expect(exitCode).toBe(0);
});
