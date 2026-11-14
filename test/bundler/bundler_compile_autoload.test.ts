import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// One entry point probes every source a standalone executable can autoload
// at run time: .env, bunfig.toml (through its preload), tsconfig.json paths
// and package.json exports. Each case compiles it with one flag set, runs it
// in a directory that holds all four files, and pins the exact set it loaded.
// The import specifiers are built at run time so the bundler cannot resolve
// them and the runtime resolver has to.
const probeEntry = {
  "/entry.ts": /* ts */ `
    const tsconfigPath = "@utils/" + "helper";
    const packagePath = "runtime-pkg/" + "utils";
    const tryImport = (specifier: string) => import(specifier).then(m => m.default, e => e.code);
    console.log("dotenv: " + (process.env.TEST_VAR ?? "not found"));
    console.log("tsconfig: " + (await tryImport(tsconfigPath)));
    console.log("packageJson: " + (await tryImport(packagePath)));
    console.log("execArgv: " + JSON.stringify(process.execArgv));
  `,
};

// Written after the build, so only the executable sees them.
const autoloadFiles = {
  "/.env": `TEST_VAR=from_dotenv`,
  "/bunfig.toml": `preload = ["./preload.ts"]`,
  "/preload.ts": `console.log("bunfig: preload ran");`,
  "/tsconfig.json": JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "@utils/*": ["./src/utils/*"],
      },
    },
  }),
  "/src/utils/helper.ts": `export default "helper-from-tsconfig-paths";`,
  "/node_modules/runtime-pkg/package.json": JSON.stringify({
    name: "runtime-pkg",
    exports: {
      "./utils": "./lib/utils.js",
    },
  }),
  "/node_modules/runtime-pkg/lib/utils.js": `export default "utils-from-package-exports";`,
};

function probeOutput(loaded: {
  dotenv: "from_dotenv" | "from_shell" | "not found";
  bunfig: boolean;
  tsconfig: boolean;
  packageJson: boolean;
  execArgv?: string[];
}): string {
  return [
    ...(loaded.bunfig ? ["bunfig: preload ran"] : []),
    `dotenv: ${loaded.dotenv}`,
    `tsconfig: ${loaded.tsconfig ? "helper-from-tsconfig-paths" : "ERR_MODULE_NOT_FOUND"}`,
    `packageJson: ${loaded.packageJson ? "utils-from-package-exports" : "ERR_MODULE_NOT_FOUND"}`,
    `execArgv: ${JSON.stringify(loaded.execArgv ?? [])}`,
  ].join("\n");
}

// Not describe.concurrent: the backend:"cli" cases each spawn a full
// `bun build --compile` link (hundreds of MB on disk) and running eight of
// those at once SIGTERMs on the linux lanes. expectBundled already forces
// backend:"api" cases to it.serial, so only the CLI cases would overlap.
describe("bundler", () => {
  // Defaults: .env and bunfig.toml load, tsconfig.json and package.json do not.
  // The second run checks that the process environment wins over .env.
  itBundled("compile/AutoloadDefaults", {
    compile: true,
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: [
      {
        stdout: probeOutput({ dotenv: "from_dotenv", bunfig: true, tsconfig: false, packageJson: false }),
        stderr: "",
        setCwd: true,
      },
      {
        stdout: probeOutput({ dotenv: "from_shell", bunfig: true, tsconfig: false, packageJson: false }),
        stderr: "",
        setCwd: true,
        env: {
          TEST_VAR: "from_shell",
        },
      },
    ],
  });

  itBundled("compile/AutoloadDotenvDisabled", {
    compile: {
      autoloadDotenv: false,
    },
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({ dotenv: "not found", bunfig: true, tsconfig: false, packageJson: false }),
      stderr: "",
      setCwd: true,
    },
  });

  itBundled("compile/AutoloadBunfigDisabled", {
    compile: {
      autoloadBunfig: false,
    },
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({ dotenv: "from_dotenv", bunfig: false, tsconfig: false, packageJson: false }),
      stderr: "",
      setCwd: true,
    },
  });

  itBundled("compile/AutoloadTsconfigEnabled", {
    compile: {
      autoloadTsconfig: true,
    },
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({ dotenv: "from_dotenv", bunfig: true, tsconfig: true, packageJson: false }),
      stderr: "",
      setCwd: true,
    },
  });

  itBundled("compile/AutoloadPackageJsonEnabled", {
    compile: {
      autoloadPackageJson: true,
    },
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({ dotenv: "from_dotenv", bunfig: true, tsconfig: false, packageJson: true }),
      stderr: "",
      setCwd: true,
    },
  });

  // Every flag explicitly true. execArgv must not change what loads.
  itBundled("compile/AutoloadAllEnabledWithExecArgv", {
    compile: {
      autoloadDotenv: true,
      autoloadBunfig: true,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      execArgv: ["--smol"],
    },
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({
        dotenv: "from_dotenv",
        bunfig: true,
        tsconfig: true,
        packageJson: true,
        execArgv: ["--smol"],
      }),
      stderr: "",
      setCwd: true,
    },
  });

  // Every flag explicitly false. With execArgv present, bunfig.toml used to
  // load anyway (#25640).
  itBundled("compile/AutoloadAllDisabledWithExecArgv", {
    compile: {
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadTsconfig: false,
      autoloadPackageJson: false,
      execArgv: ["--smol"],
    },
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({
        dotenv: "not found",
        bunfig: false,
        tsconfig: false,
        packageJson: false,
        execArgv: ["--smol"],
      }),
      stderr: "",
      setCwd: true,
    },
  });

  // The CLI maps each --compile-autoload-* flag to its own bit. The two mixed
  // cases flip one default-on flag off and one default-off flag on, so a flag
  // that lands on the wrong bit shows up in the probe.
  itBundled("compile/AutoloadDotenvDisabledTsconfigEnabledCLI", {
    compile: {
      autoloadDotenv: false,
      autoloadTsconfig: true,
    },
    backend: "cli",
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({ dotenv: "not found", bunfig: true, tsconfig: true, packageJson: false }),
      stderr: "",
      setCwd: true,
    },
  });

  itBundled("compile/AutoloadBunfigDisabledPackageJsonEnabledCLI", {
    compile: {
      autoloadBunfig: false,
      autoloadPackageJson: true,
    },
    backend: "cli",
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({ dotenv: "from_dotenv", bunfig: false, tsconfig: false, packageJson: true }),
      stderr: "",
      setCwd: true,
    },
  });

  itBundled("compile/AutoloadAllEnabledWithExecArgvCLI", {
    compile: {
      autoloadDotenv: true,
      autoloadBunfig: true,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({
        dotenv: "from_dotenv",
        bunfig: true,
        tsconfig: true,
        packageJson: true,
        execArgv: ["--smol"],
      }),
      stderr: "",
      setCwd: true,
    },
  });

  // --no-compile-autoload-bunfig with --compile-exec-argv is the CLI shape of #25640.
  itBundled("compile/AutoloadAllDisabledWithExecArgvCLI", {
    compile: {
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadTsconfig: false,
      autoloadPackageJson: false,
      execArgv: ["--smol"],
    },
    backend: "cli",
    files: probeEntry,
    runtimeFiles: autoloadFiles,
    run: {
      stdout: probeOutput({
        dotenv: "not found",
        bunfig: false,
        tsconfig: false,
        packageJson: false,
        execArgv: ["--smol"],
      }),
      stderr: "",
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

        // Remove the source so the Worker has to come from the embedded graph.
        rmSync("./worker.ts", { force: true });

        const worker = new Worker("./worker.ts");
        console.log("worker: " + await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
        }));
        worker.terminate();
        console.log("main: " + (process.env.TEST_VAR ?? "not found"));
      `,
      "/worker.ts": /* js */ `
        postMessage(process.env.TEST_VAR ?? "not found");
      `,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "worker: not found\nmain: not found",
      stderr: "",
      file: "dist/out",
      setCwd: true,
    },
  });
});
