import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// tsconfig "jsx": "react-jsx" selects the production automatic runtime (jsx/jsxs),
// "react-jsxdev" selects the development runtime (jsxDEV), matching TypeScript/esbuild.
// https://github.com/oven-sh/bun/issues/4227

const shimFiles = {
  "node_modules/shim/package.json": JSON.stringify({
    name: "shim",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./rt.js",
      "./jsx-runtime": "./rt.js",
      "./jsx-dev-runtime": "./dev.js",
    },
  }),
  "node_modules/shim/rt.js": `
    export const Fragment = Symbol.for("F");
    export const jsx = () => (console.log("prod jsx"), {});
    export const jsxs = jsx;
  `,
  "node_modules/shim/dev.js": `
    export const Fragment = Symbol.for("F");
    export const jsxDEV = () => (console.log("dev jsxDEV"), {});
  `,
  "m.jsx": `const a = <div p="1">x</div>;\nglobalThis.s = a;\n`,
};

describe("tsconfig compilerOptions.jsx", () => {
  test.each([
    ["react-jsx", "prod jsx", "shim/jsx-runtime"],
    ["react-jsxdev", "dev jsxDEV", "shim/jsx-dev-runtime"],
  ] as const)('"%s" selects the matching automatic runtime', async (jsx, runStdout, importSource) => {
    using dir = tempDir("jsx-tsconfig", {
      ...shimFiles,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { jsx, jsxImportSource: "shim" },
      }),
    });

    // bun run
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "m.jsx"],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: runStdout, exitCode: 0 });
    }

    // bun build
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "m.jsx", "--external", "shim*"],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toContain(`"${importSource}"`);
      expect(stdout).not.toContain(importSource === "shim/jsx-runtime" ? "jsx-dev-runtime" : '"shim/jsx-runtime"');
      expect(exitCode).toBe(0);
    }
  });

  // Passing any --jsx-* CLI flag must not override tsconfig's dev/prod selection.
  describe.concurrent("bun build: --jsx-* flags preserve tsconfig dev/prod", () => {
    const flags = [
      ["--jsx-runtime=automatic"],
      ["--jsx-import-source=shim"],
      ["--jsx-fragment=Fragment"],
      ["--jsx-factory=h"],
    ] as const;
    for (const extraArgs of flags) {
      for (const [jsx, importSource] of [
        ["react-jsx", "shim/jsx-runtime"],
        ["react-jsxdev", "shim/jsx-dev-runtime"],
      ] as const) {
        test(`tsconfig "${jsx}" + ${extraArgs.join(" ")} -> ${importSource}`, async () => {
          using dir = tempDir("jsx-tsconfig-cli", {
            ...shimFiles,
            "b.jsx": `export const b = <span />;\n`,
            "m.jsx": `import "./b.jsx";\nexport const a = <div p="1">x</div>;\n`,
            "tsconfig.json": JSON.stringify({ compilerOptions: { jsx, jsxImportSource: "shim" } }),
          });
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", "m.jsx", "--external", "shim*", ...extraArgs],
            env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect(stderr).toBe("");
          // Both the entry point and the imported file go through the bundler;
          // neither should have its runtime flipped.
          const unwanted = importSource === "shim/jsx-runtime" ? "shim/jsx-dev-runtime" : "shim/jsx-runtime";
          expect(stdout).toContain(`"${importSource}"`);
          expect(stdout).not.toContain(`"${unwanted}"`);
          expect(exitCode).toBe(0);
        });
      }
    }

    test("--production still forces the production runtime over tsconfig react-jsxdev", async () => {
      using dir = tempDir("jsx-tsconfig-prod", {
        ...shimFiles,
        "tsconfig.json": JSON.stringify({
          compilerOptions: { jsx: "react-jsxdev", jsxImportSource: "shim" },
        }),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "m.jsx", "--external", "shim*", "--production"],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain("shim/jsx-runtime");
      expect(stdout).not.toContain("jsx-dev-runtime");
      expect(exitCode).toBe(0);
    });
  });

  // An explicit jsx.development / jsx.runtime value passed to Bun.build must win
  // over a conflicting tsconfig "jsx" setting, same as it did before the per-file
  // merge became load-bearing.
  describe("Bun.build: explicit jsx.development overrides tsconfig", () => {
    for (const [opt, tsjsx, want] of [
      [{ development: false }, "react-jsxdev", "shim/jsx-runtime"],
      [{ development: true }, "react-jsx", "shim/jsx-dev-runtime"],
      [{ runtime: "react-jsx" }, "react-jsxdev", "shim/jsx-runtime"],
      [{ runtime: "react-jsxdev" }, "react-jsx", "shim/jsx-dev-runtime"],
      [{ runtime: "automatic" }, "react-jsx", "shim/jsx-runtime"],
      [{ runtime: "automatic" }, "react-jsxdev", "shim/jsx-dev-runtime"],
    ] as const) {
      test(`jsx: ${JSON.stringify(opt)} vs tsconfig "${tsjsx}" -> ${want}`, async () => {
        using dir = tempDir("jsx-api-override", {
          ...shimFiles,
          "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: tsjsx, jsxImportSource: "shim" } }),
        });
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `const r = await Bun.build({ entrypoints: ["m.jsx"], external: ["shim*"], jsx: ${JSON.stringify(opt)} });
             if (!r.success) { console.error(r.logs.join("\\n")); process.exit(1); }
             process.stdout.write(await r.outputs[0].text());`,
          ],
          env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        const unwanted = want === "shim/jsx-runtime" ? "shim/jsx-dev-runtime" : "shim/jsx-runtime";
        expect(stdout).toContain(`"${want}"`);
        expect(stdout).not.toContain(`"${unwanted}"`);
        expect(exitCode).toBe(0);
      });
    }
  });

  // A plugin onResolve that returns a disk path bypasses the resolver, so the
  // bundler has to look up the enclosing tsconfig itself. Both the disk-resolved
  // entry and the plugin-resolved file should land on the same runtime.
  test.each([
    ["react-jsx", "shim/jsx-runtime"],
    ["react-jsxdev", "shim/jsx-dev-runtime"],
  ] as const)("Bun.build onResolve -> disk path honors tsconfig %s", async (tsjsx, want) => {
    using dir = tempDir("jsx-onresolve", {
      ...shimFiles,
      "v.jsx": `export const v = <span />;\n`,
      "m.jsx": `import "virt"; export const a = <div />;\n`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: tsjsx, jsxImportSource: "shim" } }),
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.build({
           entrypoints: ["m.jsx"],
           external: ["shim*"],
           plugins: [{ name: "p", setup(b) {
             b.onResolve({ filter: /^virt$/ }, () => ({ path: process.cwd() + "/v.jsx", namespace: "file" }));
           }}],
         });
         if (!r.success) { console.error(r.logs.join("\\n")); process.exit(1); }
         process.stdout.write(await r.outputs[0].text());`,
      ],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const unwanted = want === "shim/jsx-runtime" ? "shim/jsx-dev-runtime" : "shim/jsx-runtime";
    expect(stdout).toContain(`"${want}"`);
    expect(stdout).not.toContain(`"${unwanted}"`);
    expect(exitCode).toBe(0);
  });
});
