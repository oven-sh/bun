// require() of an ES module loads the whole graph without a yield to the event loop. The loader
// fetches each module synchronously, but a queued job hands the source to the module's registry
// entry. Until that job runs, the entry looks like a fetch that is still in flight. A second request
// for the module, and a require() of it from code that runs in between, must use the source that is
// already there.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("require(esm) loads a module that two siblings import once", async () => {
  using dir = tempDir("require-esm-fetched-once", {
    "index.cjs": `
      const loads = [];
      Bun.plugin({
        name: "count-loads",
        setup(build) {
          build.onLoad({ filter: /\\.mjs$/ }, args => {
            loads.push(require("node:path").basename(args.path));
            return { contents: require("node:fs").readFileSync(args.path, "utf8"), loader: "js" };
          });
        },
      });
      require("./root.mjs");
      console.log(JSON.stringify(loads));
    `,
    "root.mjs": `import "./a.mjs";\nimport "./b.mjs";\n`,
    "a.mjs": `import "./shared.mjs";\n`,
    "b.mjs": `import "./shared.mjs";\n`,
    "shared.mjs": `export {};\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({
    stdout: JSON.stringify(["root.mjs", "a.mjs", "b.mjs", "shared.mjs"]) + "\n",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// The loader evaluates a CommonJS module when it creates the module's record. Here that happens for
// second.cjs while the imports of esm.mjs are requested, one request after leaf.mjs was fetched.
test.concurrent("require() of an ES module that the enclosing graph has just fetched", async () => {
  using dir = tempDir("require-esm-just-fetched", {
    "index.cjs": `globalThis.order = [];\nrequire("./root.mjs");\nconsole.log(JSON.stringify(globalThis.order));\n`,
    "root.mjs": `import "./first.cjs";\nimport "./second.cjs";\nglobalThis.order.push("root");\n`,
    "first.cjs": `require("./esm.mjs");\nglobalThis.order.push("first");\n`,
    "esm.mjs": `import "./leaf.mjs";\nimport "./second.cjs";\nglobalThis.order.push("esm");\n`,
    "second.cjs": `require("./leaf.mjs");\nglobalThis.order.push("second");\n`,
    "leaf.mjs": `globalThis.order.push("leaf");\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({
    stdout: JSON.stringify(["leaf", "second", "esm", "first", "root"]) + "\n",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// The loader reads the exports of a CommonJS module when it creates the module's record. Here the
// import() in second.cjs comes one request after counted.cjs was fetched, and the record must still be
// created once.
test.concurrent("import() of a CommonJS module that the enclosing graph has just fetched", async () => {
  using dir = tempDir("require-esm-built-once", {
    "index.cjs": `require("./root.mjs");\nglobalThis.imported.then(ns => console.log(JSON.stringify({ reads: globalThis.reads, x: ns.x })));\n`,
    "root.mjs": `import "./first.cjs";\nimport "./second.cjs";\n`,
    "first.cjs": `require("./esm.mjs");\n`,
    "esm.mjs": `import "./counted.cjs";\nimport "./second.cjs";\n`,
    "second.cjs": `globalThis.imported = import("./counted.cjs");\n`,
    "counted.cjs": `globalThis.reads = 0;\nObject.defineProperty(module.exports, "x", { enumerable: true, get: () => ++globalThis.reads });\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify({ reads: 1, x: 1 }) + "\n", stderr: "" });
  expect(exitCode).toBe(0);
});
