import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// tsconfig.json "extends" resolution. The matrix follows tsc (and esbuild's
// port of it): relative paths with an implicit ".json", package specifiers
// looked up in node_modules (bare name, "pkg/file", "pkg/file.json", the
// package.json "tsconfig" field, and "exports"), TS 5.0 arrays, and the way
// inherited "paths" / "baseUrl" / "${configDir}" combine across the chain.

async function runFile(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function build(dir: string, entry: string, ...extra: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", entry, ...extra],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// jsx: "react" with custom factories. No import is needed at runtime, so the
// factory names in the output prove which config was applied.
const jsxBase = {
  compilerOptions: { jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Frag" },
};
const jsxApp = `
  function h(tag: any, _props: any) { return "h:" + (typeof tag === "string" ? tag : tag.name); }
  function Frag() {}
  console.log(<div />, <></>);
`;
const jsxExpected = "h:div h:Frag\n";

// A node_modules directory disables auto-install, so a bare specifier that
// "paths" fails to remap is a resolution error instead of a registry fetch.
const noAutoInstall = { "node_modules/.keep": "" };

function expectJsxBuild(out: string) {
  expect(out).toContain('h("div"');
  expect(out).toContain("h(Frag");
  expect(out).not.toContain("jsxDEV");
}

// A legacy (experimentalDecorators) method decorator receives three
// arguments. A standard decorator receives two.
const decoratorApp = `
  function dec(..._args: any[]) { console.log("dec args:", _args.length); }
  class A { @dec m() {} }
  new A();
`;

describe("tsconfig extends", () => {
  describe("relative", () => {
    test.concurrent("implicit .json extension (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-implicit-json", {
        ...noAutoInstall,
        "config/base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "./config/base" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("implicit .json extension (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-implicit-json-build", {
        ...noAutoInstall,
        "config/base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "./config/base" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app.tsx", "--external", "*");
      expect(stderr).toBe("");
      expectJsxBuild(stdout);
      expect(exitCode).toBe(0);
    });

    test.concurrent("explicit .json extension", async () => {
      using dir = tempDir("tsconfig-extends-explicit-json", {
        ...noAutoInstall,
        "config/base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "./config/base.json" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a directory with the same name as the base is skipped", async () => {
      using dir = tempDir("tsconfig-extends-dir-shadow", {
        ...noAutoInstall,
        // "./config/base" names both a directory and a ".json" file. tsc only
        // accepts files here, so "./config/base.json" is the base.
        "config/base/tsconfig.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG", jsxFragmentFactory: "WRONG" },
        }),
        "config/base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "./config/base" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a bare sibling name without './' still resolves relative to the file", async () => {
      // tsc rejects this shape, but older Bun versions accepted it.
      using dir = tempDir("tsconfig-extends-bare-sibling", {
        ...noAutoInstall,
        "base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "base.json" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("the leaf's experimentalDecorators survives a single-string chain", async () => {
      // The NestJS and TypeORM shape: the base has no decorator settings.
      using dir = tempDir("tsconfig-extends-leaf-decorators", {
        ...noAutoInstall,
        "base.json": JSON.stringify({ compilerOptions: { target: "ES2022" } }),
        "tsconfig.json": JSON.stringify({
          extends: "./base.json",
          compilerOptions: { experimentalDecorators: true },
        }),
        "app.ts": decoratorApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("dec args: 3\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a relative path into node_modules follows that file's own extends", async () => {
      using dir = tempDir("tsconfig-extends-relative-into-node-modules", {
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg" }),
        "node_modules/pkg/app.json": JSON.stringify({ extends: "./flags.json" }),
        "node_modules/pkg/flags.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "./node_modules/pkg/app.json" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("'..' means the tsconfig.json in that directory", async () => {
      using dir = tempDir("tsconfig-extends-dot", {
        ...noAutoInstall,
        "tsconfig.json": JSON.stringify(jsxBase),
        "sub/tsconfig.json": JSON.stringify({ extends: ".." }),
        "sub/app.tsx": jsxApp,
      });
      // The runtime reads JSX settings from the tsconfig.json of the working
      // directory, so run from `sub` to make `extends: ".."` the config in use.
      const { stdout, stderr, exitCode } = await runFile(join(String(dir), "sub"), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });
  });

  describe("package specifier", () => {
    test.concurrent("bare package name resolves to <pkg>/tsconfig.json (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-bare-pkg", {
        ...noAutoInstall,
        "node_modules/@tsconfig/strictest/package.json": JSON.stringify({ name: "@tsconfig/strictest" }),
        "node_modules/@tsconfig/strictest/tsconfig.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "@tsconfig/strictest" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("bare package name resolves to <pkg>/tsconfig.json (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-bare-pkg-build", {
        ...noAutoInstall,
        "node_modules/@tsconfig/strictest/package.json": JSON.stringify({ name: "@tsconfig/strictest" }),
        "node_modules/@tsconfig/strictest/tsconfig.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "@tsconfig/strictest" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app.tsx", "--external", "*");
      expect(stderr).toBe("");
      expectJsxBuild(stdout);
      expect(exitCode).toBe(0);
    });

    test.concurrent("<pkg>/tsconfig.json with paths and experimentalDecorators (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-pkg-file-json", {
        ...noAutoInstall,
        "node_modules/@tsconfig/strictest/package.json": JSON.stringify({ name: "@tsconfig/strictest" }),
        "node_modules/@tsconfig/strictest/tsconfig.json": JSON.stringify({
          compilerOptions: { experimentalDecorators: true, paths: { "@lib/*": ["../../../lib/*"] } },
        }),
        "lib/x.ts": `export const v = "lib-v";`,
        "tsconfig.json": JSON.stringify({ extends: "@tsconfig/strictest/tsconfig.json" }),
        "d.ts": `
          import { v } from "@lib/x";
          ${decoratorApp}
          console.log(v);
        `,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "d.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("dec args: 3\nlib-v\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("<pkg>/tsconfig.json with paths and experimentalDecorators (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-pkg-file-json-build", {
        ...noAutoInstall,
        "node_modules/@tsconfig/strictest/package.json": JSON.stringify({ name: "@tsconfig/strictest" }),
        "node_modules/@tsconfig/strictest/tsconfig.json": JSON.stringify({
          compilerOptions: { experimentalDecorators: true, paths: { "@lib/*": ["../../../lib/*"] } },
        }),
        "lib/x.ts": `export const v = "lib-v";`,
        "tsconfig.json": JSON.stringify({ extends: "@tsconfig/strictest/tsconfig.json" }),
        "d.ts": `
          import { v } from "@lib/x";
          ${decoratorApp}
          console.log(v);
        `,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "d.ts");
      expect(stderr).toBe("");
      expect(stdout).toContain("lib-v");
      // Legacy decorators lower through this helper; standard decorators do not.
      expect(stdout).toContain("__legacyDecorateClassTS");
      expect(exitCode).toBe(0);
    });

    test.concurrent("<pkg>/file resolves to <pkg>/file.json", async () => {
      using dir = tempDir("tsconfig-extends-pkg-file", {
        ...noAutoInstall,
        "node_modules/expo/package.json": JSON.stringify({ name: "expo" }),
        "node_modules/expo/tsconfig.base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("<pkg>/file.json", async () => {
      using dir = tempDir("tsconfig-extends-pkg-file-ext", {
        ...noAutoInstall,
        "node_modules/expo/package.json": JSON.stringify({ name: "expo" }),
        "node_modules/expo/tsconfig.base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base.json" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent('package.json "tsconfig" field', async () => {
      using dir = tempDir("tsconfig-extends-pkg-tsconfig-field", {
        ...noAutoInstall,
        "node_modules/@my/config/package.json": JSON.stringify({
          name: "@my/config",
          tsconfig: "./configs/base.json",
        }),
        "node_modules/@my/config/configs/base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "@my/config" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent('package.json "tsconfig" field does not apply to a subpath', async () => {
      using dir = tempDir("tsconfig-extends-pkg-tsconfig-field-subpath", {
        ...noAutoInstall,
        "node_modules/expo/package.json": JSON.stringify({ name: "expo", tsconfig: "./configs/other.json" }),
        "node_modules/expo/configs/other.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG", jsxFragmentFactory: "WRONG" },
        }),
        "node_modules/expo/tsconfig.base.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "expo/tsconfig.base" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent('package.json "exports" subpath', async () => {
      using dir = tempDir("tsconfig-extends-pkg-exports", {
        ...noAutoInstall,
        "node_modules/@cfg/base/package.json": JSON.stringify({
          name: "@cfg/base",
          exports: { "./tsconfig": "./dist/the-config.json" },
        }),
        "node_modules/@cfg/base/dist/the-config.json": JSON.stringify(jsxBase),
        "tsconfig.json": JSON.stringify({ extends: "@cfg/base/tsconfig" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent('package.json "exports" with conditions', async () => {
      using dir = tempDir("tsconfig-extends-pkg-exports-cond", {
        ...noAutoInstall,
        "node_modules/@cfg/base/package.json": JSON.stringify({
          name: "@cfg/base",
          exports: { "./tsconfig": { require: "./dist/the-config.json", default: "./dist/wrong.json" } },
        }),
        "node_modules/@cfg/base/dist/the-config.json": JSON.stringify(jsxBase),
        "node_modules/@cfg/base/dist/wrong.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG", jsxFragmentFactory: "WRONG" },
        }),
        "tsconfig.json": JSON.stringify({ extends: "@cfg/base/tsconfig" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("node_modules in an ancestor directory (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-pkg-ancestor", {
        ...noAutoInstall,
        "node_modules/@tsconfig/node20/package.json": JSON.stringify({ name: "@tsconfig/node20" }),
        "node_modules/@tsconfig/node20/tsconfig.json": JSON.stringify(jsxBase),
        "packages/app/tsconfig.json": JSON.stringify({ extends: "@tsconfig/node20/tsconfig.json" }),
        "packages/app/app.tsx": jsxApp,
      });
      // The runtime reads JSX settings from the tsconfig.json of the working
      // directory, so run from the package.
      const { stdout, stderr, exitCode } = await runFile(join(String(dir), "packages", "app"), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("node_modules in an ancestor directory (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-pkg-ancestor-build", {
        ...noAutoInstall,
        "node_modules/@tsconfig/node20/package.json": JSON.stringify({ name: "@tsconfig/node20" }),
        "node_modules/@tsconfig/node20/tsconfig.json": JSON.stringify(jsxBase),
        "packages/app/tsconfig.json": JSON.stringify({ extends: "@tsconfig/node20/tsconfig.json" }),
        "packages/app/app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "packages/app/app.tsx", "--external", "*");
      expect(stderr).toBe("");
      expectJsxBuild(stdout);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a symlinked workspace package resolves its paths from its real location", async () => {
      using dir = tempDir("tsconfig-extends-pkg-symlink", {
        "packages/cfg/package.json": JSON.stringify({ name: "@repo/cfg" }),
        "packages/cfg/tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "@shared/*": ["../shared/*"] } },
        }),
        "packages/shared/util.ts": `export const v = "shared-util";`,
        "apps/web/node_modules/.keep": "",
        "apps/web/tsconfig.json": JSON.stringify({ extends: "@repo/cfg/tsconfig.json" }),
        "apps/web/entry.ts": `import { v } from "@shared/util"; console.log(v);`,
      });
      mkdirSync(join(String(dir), "apps", "web", "node_modules", "@repo"));
      symlinkSync(
        join(String(dir), "packages", "cfg"),
        join(String(dir), "apps", "web", "node_modules", "@repo", "cfg"),
        isWindows ? "junction" : "dir",
      );
      const { stdout, stderr, exitCode } = await runFile(join(String(dir), "apps", "web"), "entry.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("shared-util\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("jsxImportSource is inherited through a chain inside node_modules", async () => {
      using dir = tempDir("tsconfig-extends-pkg-jsx-import-source", {
        ...noAutoInstall,
        "node_modules/@vue/tsconfig/package.json": JSON.stringify({ name: "@vue/tsconfig" }),
        "node_modules/@vue/tsconfig/tsconfig.json": JSON.stringify({
          compilerOptions: { jsx: "react-jsx", jsxImportSource: "vue" },
        }),
        "node_modules/@vue/tsconfig/tsconfig.dom.json": JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions: { lib: ["DOM"] },
        }),
        "tsconfig.json": JSON.stringify({ extends: "@vue/tsconfig/tsconfig.dom.json" }),
        "app.tsx": `console.log(<div />);`,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app.tsx", "--external", "*");
      expect(stderr).toBe("");
      expect(stdout).toContain(`from "vue/jsx-runtime"`);
      expect(stdout).not.toContain("jsxDEV");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a base inside node_modules can extend another file", async () => {
      using dir = tempDir("tsconfig-extends-pkg-chain", {
        ...noAutoInstall,
        "node_modules/astro/package.json": JSON.stringify({ name: "astro" }),
        "node_modules/astro/tsconfigs/base.json": JSON.stringify(jsxBase),
        "node_modules/astro/tsconfigs/strict.json": JSON.stringify({ extends: "./base.json" }),
        "tsconfig.json": JSON.stringify({ extends: "astro/tsconfigs/strict" }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });
  });

  describe("array", () => {
    test.concurrent("every entry is applied, later entries override earlier ones (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-array", {
        ...noAutoInstall,
        "base1.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG", jsxFragmentFactory: "Frag" },
        }),
        "base2.json": JSON.stringify({ compilerOptions: { jsxFactory: "h", experimentalDecorators: true } }),
        "tsconfig.json": JSON.stringify({ extends: ["./base1.json", "./base2.json"] }),
        "app.tsx": `
          ${jsxApp}
          ${decoratorApp}
        `,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected + "dec args: 3\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("every entry is applied, later entries override earlier ones (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-array-build", {
        ...noAutoInstall,
        "base1.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG", jsxFragmentFactory: "Frag" },
        }),
        "base2.json": JSON.stringify({ compilerOptions: { jsxFactory: "h" } }),
        "tsconfig.json": JSON.stringify({ extends: ["./base1.json", "./base2.json"] }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app.tsx", "--external", "*");
      expect(stderr).toBe("");
      expectJsxBuild(stdout);
      expect(stdout).not.toContain("WRONG");
      expect(exitCode).toBe(0);
    });

    test.concurrent("the file's own options override every base", async () => {
      using dir = tempDir("tsconfig-extends-array-own", {
        ...noAutoInstall,
        "base1.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG1", jsxFragmentFactory: "Frag" },
        }),
        "base2.json": JSON.stringify({ compilerOptions: { jsxFactory: "WRONG2" } }),
        "tsconfig.json": JSON.stringify({
          extends: ["./base1.json", "./base2.json"],
          compilerOptions: { jsxFactory: "h" },
        }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });

    test.concurrent("mixes relative and package entries", async () => {
      using dir = tempDir("tsconfig-extends-array-mixed", {
        ...noAutoInstall,
        "node_modules/@tsconfig/node20/package.json": JSON.stringify({ name: "@tsconfig/node20" }),
        "node_modules/@tsconfig/node20/tsconfig.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "h" },
        }),
        "local.json": JSON.stringify({ compilerOptions: { jsxFragmentFactory: "Frag" } }),
        "tsconfig.json": JSON.stringify({ extends: ["@tsconfig/node20", "./local.json"] }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected);
      expect(exitCode).toBe(0);
    });
  });

  describe("nested chains", () => {
    test.concurrent("three levels: relative, package, relative", async () => {
      using dir = tempDir("tsconfig-extends-nested", {
        ...noAutoInstall,
        "node_modules/preset/package.json": JSON.stringify({ name: "preset" }),
        "node_modules/preset/tsconfig.json": JSON.stringify({
          extends: "./inner/base.json",
          compilerOptions: { jsxFragmentFactory: "Frag" },
        }),
        "node_modules/preset/inner/base.json": JSON.stringify({
          compilerOptions: { jsx: "react", jsxFactory: "WRONG", experimentalDecorators: true },
        }),
        "config/mid.json": JSON.stringify({ extends: "preset", compilerOptions: { jsxFactory: "h" } }),
        "tsconfig.json": JSON.stringify({ extends: "./config/mid" }),
        "app.tsx": `
          ${jsxApp}
          ${decoratorApp}
        `,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.tsx");
      expect(stderr).toBe("");
      expect(stdout).toBe(jsxExpected + "dec args: 3\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("useDefineForClassFields is inherited from the root of the chain", async () => {
      using dir = tempDir("tsconfig-extends-udfcf", {
        ...noAutoInstall,
        "base/root.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
        "base/mid.json": JSON.stringify({ extends: "./root" }),
        "tsconfig.json": JSON.stringify({ extends: "./base/mid.json" }),
        "index.ts": `
          let setterCalled = false;
          class Base { set p(v: any) { setterCalled = true; } get p() { return "getter"; } }
          class C extends Base { p: any = "field"; }
          new C();
          console.log(setterCalled);
        `,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "index.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("true\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("a derived file can turn an inherited boolean back off", async () => {
      using dir = tempDir("tsconfig-extends-bool-override", {
        ...noAutoInstall,
        "base.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
        "tsconfig.json": JSON.stringify({
          extends: "./base.json",
          compilerOptions: { experimentalDecorators: false },
        }),
        "app.ts": decoratorApp,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("dec args: 2\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("${configDir}", () => {
    test.concurrent("in an inherited paths entry, resolves to the root tsconfig directory (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-configdir-paths", {
        ...noAutoInstall,
        "base/tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "js/*": ["${configDir}/dist/js/*"] } },
        }),
        "base/dist/js/foo.ts": `export default "WRONG";`,
        "app/tsconfig.json": JSON.stringify({ extends: "../base/tsconfig.json" }),
        "app/dist/js/foo.ts": `export default "app-foo";`,
        "app/src/main.ts": `import x from "js/foo"; console.log(x);`,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app/src/main.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("app-foo\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("in an inherited paths entry, resolves to the root tsconfig directory (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-configdir-paths-build", {
        ...noAutoInstall,
        "base/tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "js/*": ["${configDir}/dist/js/*"] } },
        }),
        "base/dist/js/foo.ts": `export default "WRONG";`,
        "app/tsconfig.json": JSON.stringify({ extends: "../base/tsconfig.json" }),
        "app/dist/js/foo.ts": `export default "app-foo";`,
        "app/src/main.ts": `import x from "js/foo"; console.log(x);`,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app/src/main.ts");
      expect(stderr).toBe("");
      expect(stdout).toContain("app-foo");
      expect(stdout).not.toContain("WRONG");
      expect(exitCode).toBe(0);
    });

    test.concurrent("in an inherited baseUrl, resolves to the root tsconfig directory", async () => {
      using dir = tempDir("tsconfig-extends-configdir-baseurl", {
        ...noAutoInstall,
        "base/tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: "${configDir}/src", paths: { "util/*": ["lib/util/*"] } },
        }),
        "base/src/lib/util/a.ts": `export default "WRONG";`,
        "app/tsconfig.json": JSON.stringify({ extends: "../base/tsconfig.json" }),
        "app/src/lib/util/a.ts": `export default "app-a";`,
        "app/src/main.ts": `import a from "util/a"; console.log(a);`,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app/src/main.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("app-a\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("in the root config itself, resolves to its own directory", async () => {
      using dir = tempDir("tsconfig-extends-configdir-root", {
        ...noAutoInstall,
        "base/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "h" } }),
        "app/tsconfig.json": JSON.stringify({
          extends: "../base/tsconfig.json",
          compilerOptions: { paths: { "js/*": ["${configDir}/dist/js/*"] } },
        }),
        "app/dist/js/foo.ts": `export default "app-foo";`,
        "app/src/main.ts": `import x from "js/foo"; console.log(x);`,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "app/src/main.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("app-foo\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("paths and baseUrl split across the chain", () => {
    test.concurrent("paths in the base, baseUrl in the leaf (bun run)", async () => {
      using dir = tempDir("tsconfig-extends-split-paths-base", {
        ...noAutoInstall,
        "base/tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { foo: ["lib/foo.ts"] } } }),
        "tsconfig.json": JSON.stringify({
          extends: "./base/tsconfig.base.json",
          compilerOptions: { baseUrl: "." },
        }),
        "lib/foo.ts": `export const v = "lib-foo";`,
        "entry.ts": `import { v } from "foo"; console.log(v);`,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "entry.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("lib-foo\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("paths in the base, baseUrl in the leaf (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-split-paths-base-build", {
        ...noAutoInstall,
        "base/tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { foo: ["lib/foo.ts"] } } }),
        "tsconfig.json": JSON.stringify({
          extends: "./base/tsconfig.base.json",
          compilerOptions: { baseUrl: "." },
        }),
        "lib/foo.ts": `export const v = "lib-foo";`,
        "entry.ts": `import { v } from "foo"; console.log(v);`,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "entry.ts");
      expect(stderr).toBe("");
      expect(stdout).toContain("lib-foo");
      expect(exitCode).toBe(0);
    });

    test.concurrent("baseUrl in the base, paths in the leaf", async () => {
      using dir = tempDir("tsconfig-extends-split-baseurl-base", {
        ...noAutoInstall,
        // A relative baseUrl is resolved against the file that declares it.
        "base/tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: "./src" } }),
        "base/src/lib/foo.ts": `export const v = "base-src-foo";`,
        "tsconfig.json": JSON.stringify({
          extends: "./base/tsconfig.base.json",
          compilerOptions: { paths: { foo: ["lib/foo.ts"] } },
        }),
        "lib/foo.ts": `export const v = "WRONG";`,
        "entry.ts": `import { v } from "foo"; console.log(v);`,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "entry.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("base-src-foo\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("paths without any baseUrl resolve against the file that declares them", async () => {
      using dir = tempDir("tsconfig-extends-paths-no-baseurl", {
        ...noAutoInstall,
        "base/tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
        "base/src/a.ts": `export const v = "base-a";`,
        "tsconfig.json": JSON.stringify({ extends: "./base/tsconfig.base.json" }),
        "src/a.ts": `export const v = "WRONG";`,
        "entry.ts": `import { v } from "@/a"; console.log(v);`,
      });
      const { stdout, stderr, exitCode } = await runFile(String(dir), "entry.ts");
      expect(stderr).toBe("");
      expect(stdout).toBe("base-a\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("non-relative paths still warn when no file in the chain sets baseUrl", async () => {
      using dir = tempDir("tsconfig-extends-paths-warn", {
        ...noAutoInstall,
        "base/tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { foo: ["lib/foo.ts"] } } }),
        "tsconfig.json": JSON.stringify({ extends: "./base/tsconfig.base.json" }),
        "lib/foo.ts": `export const v = "lib-foo";`,
        "entry.ts": `import { v } from "foo"; console.log(v);`,
      });
      const { stderr, exitCode } = await build(String(dir), "entry.ts");
      expect(stderr).toContain('Non-relative path "lib/foo.ts" is not allowed when "baseUrl" is not set');
      expect(stderr).toContain('Could not resolve: "foo"');
      expect(exitCode).not.toBe(0);
    });
  });

  describe("diagnostics", () => {
    test.concurrent("a missing base config is a warning (bun build)", async () => {
      using dir = tempDir("tsconfig-extends-missing", {
        ...noAutoInstall,
        "tsconfig.json": JSON.stringify({ extends: "@does-not/exist" }),
        "entry.ts": `console.log("ok");`,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "entry.ts");
      expect(stderr).toContain('Cannot find base config file "@does-not/exist"');
      expect(stdout).toContain('console.log("ok")');
      expect(exitCode).toBe(0);
    });

    test.concurrent("a missing base config does not break bun run", async () => {
      using dir = tempDir("tsconfig-extends-missing-run", {
        ...noAutoInstall,
        "tsconfig.json": JSON.stringify({ extends: "./nope" }),
        "entry.ts": `console.log("ok");`,
      });
      const { stdout, exitCode } = await runFile(String(dir), "entry.ts");
      expect(stdout).toBe("ok\n");
      expect(exitCode).toBe(0);
    });

    test.concurrent("an extends cycle is a warning, not a hang", async () => {
      using dir = tempDir("tsconfig-extends-cycle", {
        ...noAutoInstall,
        "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { jsxFactory: "h" } }),
        "base.json": JSON.stringify({
          extends: "./tsconfig",
          compilerOptions: { jsx: "react", jsxFragmentFactory: "Frag" },
        }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app.tsx", "--external", "*");
      expect(stderr).toContain('Base config file "./tsconfig" forms cycle');
      expectJsxBuild(stdout);
      expect(exitCode).toBe(0);
    });

    test.concurrent("a diamond is not a cycle", async () => {
      using dir = tempDir("tsconfig-extends-diamond", {
        ...noAutoInstall,
        "shared.json": JSON.stringify(jsxBase),
        "left.json": JSON.stringify({ extends: "./shared.json" }),
        "right.json": JSON.stringify({ extends: "./shared.json" }),
        "tsconfig.json": JSON.stringify({ extends: ["./left.json", "./right.json"] }),
        "app.tsx": jsxApp,
      });
      const { stdout, stderr, exitCode } = await build(String(dir), "app.tsx", "--external", "*");
      expect(stderr).toBe("");
      expectJsxBuild(stdout);
      expect(exitCode).toBe(0);
    });
  });
});
