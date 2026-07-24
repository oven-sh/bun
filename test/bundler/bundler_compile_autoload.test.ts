import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Each compiled binary reports the full observable autoload state on one line
// so a single compile can assert dotenv, bunfig (via preload), tsconfig paths,
// and package.json exports together instead of one flag per compile.
const probeEntry = /* ts */ `
  const dyn = (p: string) => import(p).then(m => m.default).catch(() => "off");
  Promise.all([dyn("@utils/" + "helper"), dyn("runtime-pkg/" + "utils")]).then(([ts, pj]) => {
    console.log("dotenv=" + (process.env.TEST_VAR ?? "off") + " tsconfig=" + ts + " pkgjson=" + pj);
  });
`;

const probeRuntimeFiles = {
  "/.env": `TEST_VAR=from_dotenv`,
  "/bunfig.toml": `preload = ["./preload.ts"]\n`,
  "/preload.ts": `console.log("PRELOAD");`,
  "/tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@utils/*": ["./src/utils/*"] } },
  }),
  "/src/utils/helper.ts": `export default "tsconfig-helper";`,
  "/node_modules/runtime-pkg/package.json": JSON.stringify({
    name: "runtime-pkg",
    exports: { "./utils": "./lib/utils.js" },
  }),
  "/node_modules/runtime-pkg/lib/utils.js": `export default "pkg-utils";`,
};

// Not describe.concurrent: the backend:"cli" cases each spawn a full
// `bun build --compile` link (hundreds of MB on disk) and running several of
// those at once SIGTERMs on the linux lanes. expectBundled already forces
// backend:"api" cases to it.serial, so only the CLI cases would overlap.
describe("bundler", () => {
  // Defaults: dotenv/bunfig on, tsconfig/package.json off. A second run
  // proves shell env vars take precedence over .env.
  itBundled("compile/AutoloadDefaults", {
    compile: true,
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: [
      { stdout: "PRELOAD\ndotenv=from_dotenv tsconfig=off pkgjson=off", setCwd: true },
      {
        stdout: "PRELOAD\ndotenv=from_shell tsconfig=off pkgjson=off",
        setCwd: true,
        env: { TEST_VAR: "from_shell" },
      },
    ],
  });

  // autoloadDotenv:false leaves bunfig's default (on) untouched; pair it with
  // autoloadTsconfig:true so one compile exercises both flags independently.
  itBundled("compile/AutoloadDotenvDisabledTsconfigEnabled", {
    compile: { autoloadDotenv: false, autoloadTsconfig: true },
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "PRELOAD\ndotenv=off tsconfig=tsconfig-helper pkgjson=off", setCwd: true },
  });

  // autoloadBunfig:false leaves dotenv's default (on) untouched; pair it with
  // autoloadPackageJson:true so one compile exercises both flags independently.
  itBundled("compile/AutoloadBunfigDisabledPackageJsonEnabled", {
    compile: { autoloadBunfig: false, autoloadPackageJson: true },
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "dotenv=from_dotenv tsconfig=off pkgjson=pkg-utils", setCwd: true },
  });

  // Every flag explicitly true.
  itBundled("compile/AutoloadAllEnabled", {
    compile: {
      autoloadDotenv: true,
      autoloadBunfig: true,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
    },
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: {
      stdout: "PRELOAD\ndotenv=from_dotenv tsconfig=tsconfig-helper pkgjson=pkg-utils",
      setCwd: true,
    },
  });

  // Every flag explicitly false.
  itBundled("compile/AutoloadAllDisabled", {
    compile: {
      autoloadDotenv: false,
      autoloadBunfig: false,
      autoloadTsconfig: false,
      autoloadPackageJson: false,
    },
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "dotenv=off tsconfig=off pkgjson=off", setCwd: true },
  });

  // Regression test for #25640: autoloadBunfig:false must be honoured when
  // execArgv is present. The probe also asserts execArgv does not disturb the
  // other three autoload defaults.
  itBundled("compile/AutoloadBunfigDisabledWithExecArgv", {
    compile: { autoloadBunfig: false, execArgv: ["--smol"] },
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "dotenv=from_dotenv tsconfig=off pkgjson=off", setCwd: true },
  });

  itBundled("compile/AutoloadBunfigEnabledWithExecArgv", {
    compile: { autoloadBunfig: true, execArgv: ["--smol"] },
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "PRELOAD\ndotenv=from_dotenv tsconfig=off pkgjson=off", setCwd: true },
  });

  // CLI backend: exercise each --compile-autoload-* flag at least once. The
  // pairs mirror the API tests above so the same independence checks apply.
  itBundled("compile/AutoloadDotenvDisabledTsconfigEnabledCLI", {
    compile: { autoloadDotenv: false, autoloadTsconfig: true },
    backend: "cli",
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "PRELOAD\ndotenv=off tsconfig=tsconfig-helper pkgjson=off", setCwd: true },
  });

  itBundled("compile/AutoloadBunfigDisabledPackageJsonEnabledCLI", {
    compile: { autoloadBunfig: false, autoloadPackageJson: true },
    backend: "cli",
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "dotenv=from_dotenv tsconfig=off pkgjson=pkg-utils", setCwd: true },
  });

  itBundled("compile/AutoloadDotenvBunfigEnabledCLI", {
    compile: { autoloadDotenv: true, autoloadBunfig: true },
    backend: "cli",
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "PRELOAD\ndotenv=from_dotenv tsconfig=off pkgjson=off", setCwd: true },
  });

  // CLI regression test for #25640.
  itBundled("compile/AutoloadBunfigDisabledWithExecArgvCLI", {
    compile: { autoloadBunfig: false, execArgv: ["--smol"] },
    backend: "cli",
    files: { "/entry.ts": probeEntry },
    runtimeFiles: probeRuntimeFiles,
    run: { stdout: "dotenv=from_dotenv tsconfig=off pkgjson=off", setCwd: true },
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

        console.log("main=" + (process.env.TEST_VAR ?? "off"));
        const worker = new Worker("./worker.ts");
        console.log(await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
        }));
        worker.terminate();
      `,
      "/worker.ts": /* js */ `
        postMessage("worker=" + (process.env.TEST_VAR ?? "off"));
      `,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    runtimeFiles: {
      "/.env": `TEST_VAR=from_dotenv`,
    },
    run: {
      stdout: "main=off\nworker=off",
      file: "dist/out",
      setCwd: true,
    },
  });
});
