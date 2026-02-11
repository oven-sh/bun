import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

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
});
