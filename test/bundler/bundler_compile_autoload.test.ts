import { describe, expect } from "bun:test";
import { isDebug } from "harness";
import { itBundled } from "./expectBundled";

// Not describe.concurrent: the backend:"cli" cases each spawn a full
// `bun build --compile` link (hundreds of MB on disk) and running eight of
// those at once SIGTERMs on the linux lanes. expectBundled already forces
// backend:"api" cases to it.serial, so only the CLI cases would overlap.
describe("bundler", () => {
  // Test that .env files are loaded by default in standalone executables
  itBundled("compile/AutoloadDotenvDefault", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_dotenv",
      setCwd: true,
    },
  });

  // Test that .env files can be disabled with autoloadDotenv: false
  itBundled("compile/AutoloadDotenvDisabled", {
    compile: {
      autoloadDotenv: false,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "not found",
      setCwd: true,
    },
  });

  // Test that .env files can be explicitly enabled with autoloadDotenv: true
  itBundled("compile/AutoloadDotenvEnabledExplicitly", {
    compile: {
      autoloadDotenv: true,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_dotenv",
      setCwd: true,
    },
  });

  // Test that process environment variables take precedence over .env files
  itBundled("compile/AutoloadDotenvWithExistingEnv", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_shell",
      setCwd: true,
      env: {
        TEST_VAR: "from_shell",
      },
    },
  });

  // Test that bunfig.toml is loaded by default (preload is executed)
  itBundled("compile/AutoloadBunfigDefault", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test that bunfig.toml can be disabled with autoloadBunfig: false
  itBundled("compile/AutoloadBunfigDisabled", {
    compile: {
      autoloadBunfig: false,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      // When bunfig is disabled, preload should NOT execute
      stdout: "ENTRY",
      setCwd: true,
    },
  });

  // Test that bunfig.toml can be explicitly enabled with autoloadBunfig: true
  itBundled("compile/AutoloadBunfigEnabled", {
    compile: {
      autoloadBunfig: true,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadDotenv: false
  itBundled("compile/AutoloadDotenvDisabledCLI", {
    compile: {
      autoloadDotenv: false,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "not found",
      setCwd: true,
    },
  });

  // Regression test: standalone workers must not load .env when autoloadDotenv is disabled
  itBundled("compile/AutoloadDotenvDisabledWorkerCLI", {
    compile: {
      autoloadDotenv: false,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        import { rmSync } from "fs";

        rmSync("./worker.ts", { force: true });

        const worker = new Worker("./worker.ts");
        console.log(await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
        }));
        worker.terminate();
      `,
      "/worker.ts": /* js */ `
        postMessage(process.env.TEST_VAR || "not found");
      `,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "not found",
      file: "dist/out",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadDotenv: true
  itBundled("compile/AutoloadDotenvEnabledCLI", {
    compile: {
      autoloadDotenv: true,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "from_dotenv",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadBunfig: false
  itBundled("compile/AutoloadBunfigDisabledCLI", {
    compile: {
      autoloadBunfig: false,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "ENTRY",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadBunfig: true
  itBundled("compile/AutoloadBunfigEnabledCLI", {
    compile: {
      autoloadBunfig: true,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadTsconfig: true using tsconfig paths
  itBundled("compile/AutoloadTsconfigPathsCLI", {
    compile: {
      autoloadTsconfig: true,
    },
    backend: "cli",
    files: {
      "/entry.ts": /* ts */ `
        const modulePath = "@lib/" + "mymodule";
        import(modulePath)
          .then(m => console.log(m.default))
          .catch(e => console.log("import-failed: " + e.message));
      `,
    },
    runtimeFiles: {
      "/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@lib/*": ["./lib/*"],
          },
        },
      }),
      "/lib/mymodule.ts": `export default "mymodule-from-cli-tsconfig";`,
    },
    run: {
      stdout: "mymodule-from-cli-tsconfig",
      setCwd: true,
    },
  });

  // Test CLI backend with autoloadPackageJson: true using package.json exports
  itBundled("compile/AutoloadPackageJsonExportsCLI", {
    compile: {
      autoloadPackageJson: true,
    },
    backend: "cli",
    files: {
      "/entry.js": /* js */ `
        const pkgName = "cli-pkg";
        const subpath = "feature";
        import(pkgName + "/" + subpath)
          .then(m => console.log(m.default))
          .catch(e => console.log("import-failed: " + e.message));
      `,
    },
    runtimeFiles: {
      "/node_modules/cli-pkg/package.json": JSON.stringify({
        name: "cli-pkg",
        exports: {
          "./feature": "./features/main.js",
        },
      }),
      "/node_modules/cli-pkg/features/main.js": `export default "feature-from-cli-package-exports";`,
    },
    run: {
      stdout: "feature-from-cli-package-exports",
      setCwd: true,
    },
  });

  // Test CLI backend for autoloadBunfig: false with execArgv (regression test for #25640)
  itBundled("compile/AutoloadBunfigDisabledWithExecArgvCLI", {
    compile: {
      autoloadBunfig: false,
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "ENTRY",
      setCwd: true,
    },
  });

  // Test that both flags can be disabled together without interference
  itBundled("compile/AutoloadBothDisabled", {
    compile: {
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.TEST_VAR || "not found");
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "not found\nENTRY",
      setCwd: true,
    },
  });

  // Test that tsconfig.json paths are loaded at runtime when autoloadTsconfig: true
  // Uses a dynamic import path that the bundler cannot resolve at compile time
  itBundled("compile/AutoloadTsconfigPathsEnabled", {
    compile: {
      autoloadTsconfig: true,
    },
    files: {
      "/entry.ts": /* ts */ `
        // Use a dynamic path that can't be resolved at compile time
        // This forces runtime resolution using the runtime tsconfig.json
        const modulePath = "@utils/" + "helper";
        import(modulePath)
          .then(m => console.log(m.default))
          .catch(e => console.log("import-failed: " + e.message));
      `,
    },
    runtimeFiles: {
      "/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@utils/*": ["./src/utils/*"],
          },
        },
      }),
      "/src/utils/helper.ts": `export default "helper-from-tsconfig-paths";`,
    },
    run: {
      stdout: "helper-from-tsconfig-paths",
      setCwd: true,
    },
  });

  // Test that tsconfig.json paths are NOT loaded when autoloadTsconfig: false (default)
  // The import should fail because @utils/helper cannot be resolved without tsconfig paths
  itBundled("compile/AutoloadTsconfigPathsDisabled", {
    compile: {
      autoloadTsconfig: false,
    },
    files: {
      "/entry.ts": /* ts */ `
        // Without runtime tsconfig.json, @utils/helper cannot be resolved
        const modulePath = "@utils/" + "helper";
        import(modulePath)
          .then(m => console.log(m.default))
          .catch(() => console.log("import-failed-as-expected"));
      `,
    },
    runtimeFiles: {
      "/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@utils/*": ["./src/utils/*"],
          },
        },
      }),
      "/src/utils/helper.ts": `export default "helper-from-tsconfig-paths";`,
    },
    run: {
      stdout: "import-failed-as-expected",
      setCwd: true,
    },
  });

  // Test that package.json exports are loaded at runtime when autoloadPackageJson: true
  // Uses a dynamic import path that the bundler cannot resolve at compile time
  itBundled("compile/AutoloadPackageJsonExportsEnabled", {
    compile: {
      autoloadPackageJson: true,
    },
    files: {
      "/entry.js": /* js */ `
        // Use a dynamic path that can't be resolved at compile time
        const pkgName = "my-runtime-pkg";
        const subpath = "utils";
        import(pkgName + "/" + subpath)
          .then(m => console.log(m.default))
          .catch(e => console.log("import-failed: " + e.message));
      `,
    },
    runtimeFiles: {
      "/node_modules/my-runtime-pkg/package.json": JSON.stringify({
        name: "my-runtime-pkg",
        exports: {
          "./utils": "./lib/utilities.js",
        },
      }),
      "/node_modules/my-runtime-pkg/lib/utilities.js": `export default "utilities-from-package-exports";`,
    },
    run: {
      stdout: "utilities-from-package-exports",
      setCwd: true,
    },
  });

  // Test that package.json exports are NOT loaded when autoloadPackageJson: false (default)
  // The import should fail because my-runtime-pkg/utils cannot be resolved without package.json exports
  itBundled("compile/AutoloadPackageJsonExportsDisabled", {
    compile: {
      autoloadPackageJson: false,
    },
    files: {
      "/entry.js": /* js */ `
        // Without runtime package.json, my-runtime-pkg/utils cannot be resolved
        const pkgName = "my-runtime-pkg";
        const subpath = "utils";
        import(pkgName + "/" + subpath)
          .then(m => console.log(m.default))
          .catch(() => console.log("import-failed-as-expected"));
      `,
    },
    runtimeFiles: {
      "/node_modules/my-runtime-pkg/package.json": JSON.stringify({
        name: "my-runtime-pkg",
        exports: {
          "./utils": "./lib/utilities.js",
        },
      }),
      "/node_modules/my-runtime-pkg/lib/utilities.js": `export default "utilities-from-package-exports";`,
    },
    run: {
      stdout: "import-failed-as-expected",
      setCwd: true,
    },
  });

  // Test that autoloadBunfig: false works with execArgv (regression test for #25640)
  // When execArgv is present, bunfig should still be disabled if autoloadBunfig: false
  itBundled("compile/AutoloadBunfigDisabledWithExecArgv", {
    compile: {
      autoloadBunfig: false,
      execArgv: ["--smol"],
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      // When bunfig is disabled, preload should NOT execute even with execArgv
      stdout: "ENTRY",
      setCwd: true,
    },
  });

  // Test that autoloadBunfig: true with execArgv still loads bunfig
  itBundled("compile/AutoloadBunfigEnabledWithExecArgv", {
    compile: {
      autoloadBunfig: true,
      execArgv: ["--smol"],
    },
    files: {
      "/entry.ts": /* js */ `
        console.log("ENTRY");
      `,
    },
    runtimeFiles: {
      "/bunfig.toml": `
preload = ["./preload.ts"]
      `,
      "/preload.ts": `
console.log("PRELOAD");
      `,
    },
    run: {
      stdout: "PRELOAD\nENTRY",
      setCwd: true,
    },
  });

  // Test that both tsconfig and package.json can be enabled together
  itBundled("compile/AutoloadBothTsconfigAndPackageJson", {
    compile: {
      autoloadTsconfig: true,
      autoloadPackageJson: true,
    },
    files: {
      "/entry.ts": /* ts */ `
        // Both imports require runtime config files
        const tsconfigPath = "@utils/" + "helper";
        const pkgPath = "runtime-pkg/" + "utils";
        Promise.all([import(tsconfigPath), import(pkgPath)])
          .then(([helper, utils]) => console.log(helper.default + " " + utils.default))
          .catch(e => console.log("import-failed: " + e.message));
      `,
    },
    runtimeFiles: {
      "/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@utils/*": ["./src/utils/*"],
          },
        },
      }),
      "/src/utils/helper.ts": `export default "tsconfig-helper";`,
      "/node_modules/runtime-pkg/package.json": JSON.stringify({
        name: "runtime-pkg",
        exports: {
          "./utils": "./lib/utils.js",
        },
      }),
      "/node_modules/runtime-pkg/lib/utils.js": `export default "package-utils";`,
    },
    run: {
      stdout: "tsconfig-helper package-utils",
      setCwd: true,
    },
  });

  // The autoload flags are for the executable's own module resolution. A build that the
  // executable runs (Bun.build(), a macro of Bun.Transpiler, a page of Bun.serve()) reads
  // tsconfig.json and package.json like any other build. Neither side gets what the other
  // read from a directory, whichever of the two reads it first.
  //
  // The arguments of a run are steps. A step names a resolver and what it resolves, and prints
  // the file it got. "worker:" runs the step in a Worker.
  const buildInsideExecutable = {
    files: {
      "/entry.ts": /* ts */ `
        import { rmSync, writeFileSync } from "node:fs";
        import inspector from "node:inspector";
        import { join } from "node:path";
        import { isMainThread, parentPort, workerData } from "node:worker_threads";

        const cwd = process.cwd();
        // Not literals, so that only the executable resolves them, when it runs.
        const alias = "@lib/" + "thing";
        const packageName = "dual-" + "pkg";

        const marker = (text: string) => text.match(/from-[a-z-]+/)?.[0] ?? text;

        async function build(entry: string, options: Partial<Bun.BuildConfig> = { target: "bun" }) {
          const result = await Bun.build({ entrypoints: [join(cwd, entry)], throw: false, ...options });
          if (!result.success) return "failed: " + result.logs.map(log => log.message).join("; ");
          return await result.outputs[0].text();
        }

        // The script of a page that Bun.serve() bundles.
        async function servePage(development: boolean) {
          const page = await import(join(cwd, "page.html"));
          await using server = Bun.serve({ port: 0, development, routes: { "/": page.default } });
          const html = await (await fetch(server.url)).text();
          const script = await fetch(new URL(html.match(/src="([^"]+)"/)![1], server.url));
          return marker(await script.text());
        }

        const macro = 'import { marker } from "macro-pkg" with { type: "macro" }; export default marker();';

        const steps: Record<string, () => unknown> = {
          // The executable's own resolver.
          "require-file": () => require(join(cwd, "node_modules/dual-pkg/main.js")),
          "require-package": () => require(join(cwd, "node_modules/dual-pkg")),
          "import-package": () => import(packageName).then(mod => mod.default),
          "import-alias": () =>
            import(alias).then(
              mod => mod.default,
              error => (error.code === "ERR_MODULE_NOT_FOUND" ? "not found" : Promise.reject(error)),
            ),
          "require-browser-file": () => require(join(cwd, "node_modules/browser-pkg/main.js")),
          "require-late-file": () => require(join(cwd, "node_modules/late-pkg/main.js")),
          "require-macro-file": () => require(join(cwd, "node_modules/macro-pkg/main.js")).marker(),
          // A failed lookup drops the directory from the cache.
          "require-missing": () => {
            try {
              return require(join(cwd, "node_modules/dual-pkg/missing.js"));
            } catch {
              return "not found";
            }
          },
          // It returns when the debugger's VM runs.
          "open-inspector": () => (inspector.open(0, "127.0.0.1"), "listening"),

          // Changes after the executable read the directory.
          "edit-package": () => {
            const edited = JSON.stringify({ name: "dual-pkg", main: "./edited-main.js" });
            writeFileSync(join(cwd, "node_modules/dual-pkg/package.json"), edited);
            return "done";
          },
          "add-late-package": () => {
            const added = JSON.stringify({ name: "late-pkg", main: "./main.js" });
            writeFileSync(join(cwd, "node_modules/late-pkg/package.json"), added);
            return "done";
          },
          "remove-tsconfig": () => (rmSync(join(cwd, "tsconfig.json")), "done"),

          // The resolvers of the builds that the executable runs.
          "build-package": async () => marker(await build("uses-package.ts")),
          "build-late-package": async () => marker(await build("uses-late-package.ts")),
          "build-alias": async () => marker(await build("uses-alias.ts")),
          "build-imports": async () => marker(await build("uses-imports.ts")),
          "build-jsx": async () => marker(await build("uses-jsx.tsx")),
          // For a browser, the default target.
          "build-browser": async () => marker(await build("uses-browser-package.ts", {})),
          "build-decorator": async () => {
            const built = join(cwd, "built-decorator.mjs");
            writeFileSync(built, await build("uses-decorator.ts"));
            return (await import(built)).default;
          },
          "transform-macro": () => marker(new Bun.Transpiler().transformSync(macro)),
          "transform-macro-async": async () => marker(await new Bun.Transpiler().transform(macro)),
          "serve-page": () => servePage(false),
          "serve-page-dev": () => servePage(true),
        };

        if (isMainThread) {
          for (const step of process.argv.slice(2)) {
            if (step.startsWith("worker:")) {
              const worker = new Worker(import.meta.url, { workerData: step.slice("worker:".length) });
              const { promise, resolve, reject } = Promise.withResolvers();
              worker.addEventListener("message", event => resolve(event.data), { once: true });
              worker.addEventListener("error", event => reject(new Error(event.message)), { once: true });
              worker.addEventListener("close", () => reject(new Error(step + ": no message")), { once: true });
              console.log(step + ": " + (await promise));
              await worker.terminate();
            } else {
              console.log(step + ": " + (await steps[step]()));
            }
          }
        } else {
          parentPort!.postMessage(await steps[workerData]());
        }
      `,
    },
    runtimeFiles: {
      "/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@lib/*": ["./lib/*"],
          },
          jsx: "react-jsx",
          jsxImportSource: "my-jsx",
          experimentalDecorators: true,
        },
      }),
      "/package.json": JSON.stringify({ name: "project", imports: { "#imported": "./lib/imported.ts" } }),
      "/lib/thing.ts": `export default "from-tsconfig-paths";`,
      "/lib/imported.ts": `export default "from-package-imports";`,
      // A resolver that does not read package.json takes index.js.
      "/node_modules/dual-pkg/package.json": JSON.stringify({ name: "dual-pkg", main: "./main.js" }),
      "/node_modules/dual-pkg/main.js": `module.exports = "from-package-main";`,
      "/node_modules/dual-pkg/index.js": `module.exports = "from-index";`,
      "/node_modules/dual-pkg/edited-main.js": `module.exports = "from-edited-main";`,
      // "add-late-package" writes its package.json.
      "/node_modules/late-pkg/main.js": `module.exports = "from-package-main";`,
      "/node_modules/late-pkg/index.js": `module.exports = "from-index";`,
      "/node_modules/macro-pkg/package.json": JSON.stringify({ name: "macro-pkg", main: "./main.js" }),
      "/node_modules/macro-pkg/main.js": `exports.marker = () => "from-package-main";`,
      "/node_modules/macro-pkg/index.js": `exports.marker = () => "from-index";`,
      "/node_modules/browser-pkg/package.json": JSON.stringify({
        name: "browser-pkg",
        main: "./main.js",
        browser: { "./main.js": "./browser.js", "bare-dep": "./bare-dep.js" },
      }),
      "/node_modules/browser-pkg/main.js": `module.exports = "from-package-main";`,
      "/node_modules/browser-pkg/browser.js": `module.exports = require("bare-dep");`,
      "/node_modules/browser-pkg/bare-dep.js": `module.exports = "from-browser-field";`,
      "/node_modules/my-jsx/jsx-runtime.js": `export const jsx = () => "from-tsconfig-jsx";`,
      "/node_modules/my-jsx/jsx-dev-runtime.js": `export const jsxDEV = () => "from-tsconfig-jsx";`,
      "/uses-package.ts": `import pkg from "dual-pkg"; console.log(pkg);`,
      "/uses-late-package.ts": `import pkg from "late-pkg"; console.log(pkg);`,
      "/uses-browser-package.ts": `import pkg from "browser-pkg"; console.log(pkg);`,
      "/uses-alias.ts": `import thing from "@lib/thing"; console.log(thing);`,
      "/uses-imports.ts": `import imported from "#imported"; console.log(imported);`,
      "/uses-jsx.tsx": `console.log(<div />);`,
      // A decorator gets one argument with "experimentalDecorators", and two without it.
      "/uses-decorator.ts": `
        let marker = "";
        function mark(...args: unknown[]) {
          marker = args.length === 1 ? "from-legacy-decorators" : "from-standard-decorators";
        }
        @mark
        class Marked {}
        export default marker;
      `,
      "/page.html": `<!doctype html><script type="module" src="./uses-alias.ts"></script>`,
    },
  };

  itBundled("compile/AutoloadDisabledBunBuildReadsConfigFiles", {
    compile: true,
    ...buildInsideExecutable,
    run: [
      // The executable reads the working directory when it starts, to find .env files.
      {
        args: ["build-alias", "import-alias"],
        stdout: "build-alias: from-tsconfig-paths\nimport-alias: not found",
        setCwd: true,
      },
      {
        args: ["build-jsx", "build-decorator", "build-imports"],
        stdout:
          "build-jsx: from-tsconfig-jsx\nbuild-decorator: from-legacy-decorators\nbuild-imports: from-package-imports",
        setCwd: true,
      },
      // The executable reads the package's directory first.
      {
        args: ["require-file", "build-package"],
        stdout: "require-file: from-package-main\nbuild-package: from-package-main",
        setCwd: true,
      },
      {
        args: ["require-browser-file", "build-browser"],
        stdout: "require-browser-file: from-package-main\nbuild-browser: from-browser-field",
        setCwd: true,
      },
      // A build reads it first.
      {
        args: ["build-package", "require-package", "import-package"],
        stdout: "build-package: from-package-main\nrequire-package: from-index\nimport-package: from-index",
        setCwd: true,
      },
      {
        args: ["worker:require-file", "build-package"],
        stdout: "worker:require-file: from-package-main\nbuild-package: from-package-main",
        setCwd: true,
      },
      {
        args: ["build-package", "worker:require-package"],
        stdout: "build-package: from-package-main\nworker:require-package: from-index",
        setCwd: true,
      },
      {
        args: ["require-file", "worker:build-package"],
        stdout: "require-file: from-package-main\nworker:build-package: from-package-main",
        setCwd: true,
      },
      // The first build of a directory reads it as it is then.
      {
        args: ["require-late-file", "add-late-package", "build-late-package"],
        stdout: "require-late-file: from-package-main\nadd-late-package: done\nbuild-late-package: from-package-main",
        setCwd: true,
      },
      // The next build reads a directory again after the executable dropped it from the cache.
      // The last two runs, because they change the files.
      {
        args: ["build-package", "edit-package", "require-missing", "build-package"],
        stdout:
          "build-package: from-package-main\nedit-package: done\nrequire-missing: not found\nbuild-package: from-edited-main",
        setCwd: true,
      },
      {
        args: ["remove-tsconfig", "build-imports"],
        stdout: "remove-tsconfig: done\nbuild-imports: from-package-imports",
        setCwd: true,
      },
    ],
  });

  // A debug build prints each macro call.
  const macroCall = isDebug ? "[macro] call marker\n" : "";

  itBundled("compile/AutoloadDisabledMacrosAndPagesReadConfigFiles", {
    compile: true,
    ...buildInsideExecutable,
    run: [
      {
        args: ["require-macro-file", "transform-macro", "transform-macro-async"],
        stdout: `require-macro-file: from-package-main\n${macroCall}transform-macro: from-package-main\n${macroCall}transform-macro-async: from-package-main`,
        setCwd: true,
      },
      // The async form runs the macro in a VM of its own.
      {
        args: ["transform-macro-async", "transform-macro", "require-package"],
        stdout: `${macroCall}transform-macro-async: from-package-main\n${macroCall}transform-macro: from-package-main\nrequire-package: from-index`,
        setCwd: true,
      },
      {
        args: ["serve-page", "import-alias"],
        stdout: "serve-page: from-tsconfig-paths\nimport-alias: not found",
        setCwd: true,
      },
      { args: ["serve-page-dev"], stdout: "serve-page-dev: from-tsconfig-paths", setCwd: true },
    ],
  });

  itBundled("compile/AutoloadDisabledBunBuildReadsConfigFilesCLI", {
    compile: true,
    backend: "cli",
    ...buildInsideExecutable,
    run: [
      {
        args: ["build-alias", "import-alias"],
        stdout: "build-alias: from-tsconfig-paths\nimport-alias: not found",
        setCwd: true,
      },
      {
        args: ["require-file", "build-package", "require-package"],
        stdout: "require-file: from-package-main\nbuild-package: from-package-main\nrequire-package: from-index",
        setCwd: true,
      },
    ],
  });

  // Without .env files the executable does not read the working directory when it starts.
  itBundled("compile/AutoloadDisabledBunBuildReadsConfigFilesWithoutDotenv", {
    compile: {
      autoloadDotenv: false,
    },
    ...buildInsideExecutable,
    run: [
      {
        args: ["build-alias", "import-alias"],
        stdout: "build-alias: from-tsconfig-paths\nimport-alias: not found",
        setCwd: true,
      },
      {
        args: ["require-file", "build-package"],
        stdout: "require-file: from-package-main\nbuild-package: from-package-main",
        setCwd: true,
      },
      // A debugger does not change what the executable resolves.
      {
        args: ["open-inspector", "import-alias"],
        stdout: "open-inspector: listening\nimport-alias: not found",
        setCwd: true,
      },
    ],
  });

  itBundled("compile/AutoloadPackageJsonOnlyBunBuildReadsTsconfig", {
    compile: {
      autoloadPackageJson: true,
    },
    ...buildInsideExecutable,
    run: [
      {
        args: ["build-alias", "import-alias"],
        stdout: "build-alias: from-tsconfig-paths\nimport-alias: not found",
        setCwd: true,
      },
      {
        args: ["build-package", "require-package"],
        stdout: "build-package: from-package-main\nrequire-package: from-package-main",
        setCwd: true,
      },
    ],
  });

  itBundled("compile/AutoloadTsconfigOnlyBunBuildReadsPackageJson", {
    compile: {
      autoloadTsconfig: true,
    },
    ...buildInsideExecutable,
    run: [
      {
        args: ["require-file", "build-package", "require-package"],
        stdout: "require-file: from-package-main\nbuild-package: from-package-main\nrequire-package: from-index",
        setCwd: true,
      },
      {
        args: ["import-alias", "build-alias"],
        stdout: "import-alias: from-tsconfig-paths\nbuild-alias: from-tsconfig-paths",
        setCwd: true,
      },
    ],
  });

  // A resolver that reads these files reports that they end too early. The executable's own
  // VMs do not read them, and its debugger's VM does not either.
  itBundled("compile/AutoloadDisabledReadsNoConfigFiles", {
    compile: true,
    files: buildInsideExecutable.files,
    runtimeFiles: {
      "/package.json": `{"name": "truncated", "main": `,
      "/tsconfig.json": `{"compilerOptions": {"paths": `,
      "/uses-alias.ts": `console.log("from-no-config");`,
    },
    run: [
      { stdout: "", stderr: "", setCwd: true },
      {
        args: ["open-inspector"],
        stdout: "open-inspector: listening",
        setCwd: true,
        validate({ stderr }) {
          expect(stderr.replace(/ws:\/\/\S+/, "<url>")).toBe("Debugger listening on <url>\n");
        },
      },
      {
        args: ["build-alias"],
        stdout: "build-alias: failed: Unexpected end of file; Unexpected end of file",
        setCwd: true,
      },
    ],
  });
});
