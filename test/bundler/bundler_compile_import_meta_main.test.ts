import { afterEach, beforeEach, describe } from "bun:test";
import { isASAN, isDebug } from "harness";
import { itBundled } from "./expectBundled";

// Starts a Worker and gives its first message.
const startWorker = /* js */ `
  function startWorker(file: string): Promise<unknown> {
    return new Promise(resolve => {
      const worker = new Worker(file);
      worker.onmessage = event => {
        resolve(event.data);
        worker.terminate();
      };
      worker.onerror = event => resolve("error: " + event.message);
    });
  }
`;

// These cases are not in bundler_compile.test.ts. That file takes about 230 s on Windows arm64,
// and the test runner stops a bundler_compile file at 300 s.
describe.concurrent("bundler", () => {
  // Each case links an executable: `bun build --compile` copies the bun binary and writes it again.
  // As in bundler_compile_prelinked.test.ts, a case takes a slot first, so that at most three links
  // run at once. An ASAN or debug binary is about a gigabyte, so those run one at a time.
  let freeSlots = isASAN || isDebug ? 1 : 3;
  const waiting: (() => void)[] = [];
  beforeEach(async () => {
    if (freeSlots > 0) freeSlots--;
    else await new Promise<void>(resolve => waiting.push(resolve));
  }, Infinity);
  afterEach(() => {
    const next = waiting.shift();
    if (next) next();
    else freeSlots++;
  });

  // Without code splitting, the output of an entry point holds a copy of each module that it
  // imports. A copy of another entry point is not the main module, as with `bun run app.ts`.
  itBundled("edgecase/ImportMetaMainInCopyOfEntryPoint", {
    files: {
      "/cli.ts": /* js */ `
        export const cliIsMain = import.meta.main;
        if (import.meta.main) console.log("cli.ts ran as the main module");
      `,
      "/app.ts": /* js */ `
        import { cliIsMain } from "./cli.ts";
        console.log(JSON.stringify({ cliIsMain, appIsMain: import.meta.main }));
      `,
    },
    entryPoints: ["/cli.ts", "/app.ts"],
    target: "bun",
    outdir: "/out",
    run: { file: "/out/app.js", stdout: '{"cliIsMain":false,"appIsMain":true}' },
  });

  // The worker imports the first entry point, so the bundle of the worker holds a copy of it. The
  // copy is not the main module. If it were, a worker that the first entry point starts under
  // `if (import.meta.main)` starts a worker too, and so on until the process aborts.
  const workerImportsFirstEntryPoint = {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        ${startWorker}
        export function isMain() {
          return [import.meta.main, require.main === module];
        }
        if (Bun.isMainThread) {
          startWorker("./worker.ts").then(entryInWorker => console.log(JSON.stringify({ main: isMain(), entryInWorker })));
        }
      `,
      "/worker.ts": /* js */ `
        import { isMain } from "./entry.ts";
        postMessage(isMain());
      `,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":[true,true],"entryInWorker":[false,false]}', file: "dist/out", setCwd: true },
  };
  itBundled("compile/ImportMetaMainInWorker", { ...workerImportsFirstEntryPoint, backend: "cli" });
  // `--bytecode` makes CommonJS output. `Bun.build` does not inline `import.meta.main`, and its
  // CommonJS output prints `require.main == module`, which is true in the entry module of a Worker.
  for (const backend of ["cli", "api"] as const) {
    for (const bytecode of [false, true]) {
      itBundled(`compile/ImportMetaMainInWorker+${backend}+cjs${bytecode ? "+bytecode" : ""}`, {
        ...workerImportsFirstEntryPoint,
        backend,
        format: "cjs",
        bytecode,
      });
    }
  }
  // With --minify-syntax, the literal for `import.meta.main` prints as `!0` or `!1`. On the left of
  // `**`, it needs parentheses. The parser folds `!import.meta.main` into the same node.
  itBundled("compile/ImportMetaMainExponentMinified", {
    backend: "cli",
    compile: true,
    minifySyntax: true,
    files: {
      "/entry.ts": /* js */ `console.log(import.meta.main ** 2, (!import.meta.main) ** 2);`,
      "/worker.ts": /* js */ `postMessage(import.meta.main);`,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: "1 0", file: "dist/out", setCwd: true },
  });
  // An entry point that another entry point imports is copied into the bundle of that entry point.
  // The copy is not the main module. The first entry point is: the linker inlines `true` there.
  itBundled("compile/ImportMetaMainEntryImportedByOtherEntry", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        import lib from "./lib.cjs";
        console.log(JSON.stringify(lib), (() => import.meta.main).toString().includes("true"));
      `,
      "/lib.cjs": /* js */ `
        module.exports = {
          isMain: require.main === module,
          cli: (function () { if (require.main === module) return "CLI-RAN"; return "lib"; })(),
        };
      `,
    },
    entryPointsRaw: ["./entry.ts", "./lib.cjs"],
    outfile: "dist/out",
    run: { stdout: '{"isMain":false,"cli":"lib"} true', file: "dist/out", setCwd: true },
  });
  // With two JavaScript entry points, the parser does not inline `import.meta.main`, because a copy
  // needs the other value. So it cannot drop a branch that only a copy runs, and an import there
  // must resolve. `--external` keeps such an import out of the bundle.
  itBundled("compile/ImportMetaMainBranchOfCopyIsBundled", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `if (!import.meta.main) require("this-package-is-not-installed");`,
      "/worker.ts": /* js */ `postMessage("worker");`,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    bundleErrors: {
      "/entry.ts": ['Could not resolve: "this-package-is-not-installed". Maybe you need to "bun install"?'],
    },
  });
  // A module graph of its own has a main module of its own: the first module that it imports.
  itBundled("compile/ImportMetaMainInModuleGraph", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        const graph = new Bun.ModuleGraph({});
        const tenant = await graph.import(new URL("./tenant.ts", import.meta.url).href);
        console.log(JSON.stringify({ main: import.meta.main, tenant: tenant.isMain }));
        graph.dispose();
      `,
      "/tenant.ts": /* js */ `export const isMain = import.meta.main;`,
    },
    entryPointsRaw: ["./entry.ts", "./tenant.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":true,"tenant":true}', file: "dist/out", setCwd: true },
  });
  // An HTML entry point is for the browser, and a CSS entry point has no JavaScript. With one
  // JavaScript entry point, no bundle can hold a copy of it. The parser still inlines `true` and
  // drops the branch that cannot run.
  itBundled("compile/ImportMetaMainAfterHtmlAndCssEntryPoints", {
    backend: "cli",
    compile: true,
    files: {
      "/index.html": /* html */ `<!doctype html><html><head><script type="module" src="./client.ts"></script></head></html>`,
      "/client.ts": /* js */ `console.log("client");`,
      "/style.css": /* css */ `body { color: red; }`,
      "/server.ts": /* js */ `
        if (!import.meta.main) require("this-package-is-not-installed");
        console.log(JSON.stringify({ main: import.meta.main }));
      `,
    },
    entryPointsRaw: ["./index.html", "./style.css", "./server.ts", "./server.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":true}', file: "dist/out", setCwd: true },
  });
  // With a second JavaScript entry point after them, a copy is possible again.
  itBundled("compile/ImportMetaMainInWorkerAfterHtmlAndCssEntryPoints", {
    backend: "cli",
    compile: true,
    files: {
      "/index.html": /* html */ `<!doctype html><html><head><script type="module" src="./client.ts"></script></head></html>`,
      "/client.ts": /* js */ `console.log("client");`,
      "/style.css": /* css */ `body { color: red; }`,
      "/server.ts": /* js */ `
        ${startWorker}
        export const serverIsMain = import.meta.main;
        if (Bun.isMainThread) {
          startWorker("./worker.ts").then(serverInWorker => console.log(JSON.stringify({ main: serverIsMain, serverInWorker })));
        }
      `,
      "/worker.ts": /* js */ `
        import { serverIsMain } from "./server.ts";
        postMessage(serverIsMain);
      `,
    },
    entryPointsRaw: ["./index.html", "./style.css", "./server.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":true,"serverInWorker":false}', file: "dist/out", setCwd: true },
  });
  // The worker imports only "helper" from a file that also exports from the first entry point. The
  // bundler reads that other export when a file that the first entry point imports asks for it.
  // After that, the bundle of the worker holds a copy of the first entry point.
  itBundled("compile/ImportMetaMainInCopyThroughBarrelFile", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        ${startWorker}
        import { command } from "./command.ts";
        export function run() {
          return "run";
        }
        globalThis.entryIsMain = [import.meta.main, command() === run];
        if (Bun.isMainThread) {
          const main = globalThis.entryIsMain;
          startWorker("./worker.ts").then(worker => console.log(JSON.stringify({ main, worker })));
        }
      `,
      "/command.ts": /* js */ `
        import { run } from "./lib/index.ts";
        export function command() {
          return run;
        }
      `,
      "/worker.ts": /* js */ `
        import { helper } from "./lib/index.ts";
        postMessage([helper, globalThis.entryIsMain]);
      `,
      "/lib/index.ts": /* js */ `
        export { run } from "../entry.ts";
        export { helper } from "./helper.ts";
      `,
      "/lib/helper.ts": /* js */ `export const helper = "helper";`,
      "/lib/package.json": `{ "name": "lib", "sideEffects": false }`,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":[true,true],"worker":["helper",[false,true]]}', file: "dist/out", setCwd: true },
  });
  // The package has an ES module build and a CommonJS build, and the CommonJS build is the first
  // entry point. When the bundle has both builds, the bundler moves each import of the ES module
  // build to the CommonJS build. After that, the bundle of the worker holds a copy of it.
  itBundled("compile/ImportMetaMainInCopyOfDualPackage", {
    backend: "cli",
    compile: true,
    files: {
      "/node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "./lib/index.js", "module": "./es/index.js" }`,
      "/node_modules/pkg/es/index.js": /* js */ `
        export const build = "es";
        export const isMain = import.meta.main;
      `,
      "/node_modules/pkg/lib/index.js": /* js */ `
        module.exports = { build: "commonjs", isMain: require.main === module };
        if (Bun.isMainThread) {
          const worker = new Worker("./worker.ts");
          worker.onmessage = event => {
            console.log(JSON.stringify({ main: module.exports.isMain, worker: event.data }));
            worker.terminate();
          };
        }
      `,
      "/worker.ts": /* js */ `
        import { build, isMain } from "pkg";
        postMessage({ build, isMain });
      `,
    },
    entryPointsRaw: ["./node_modules/pkg/lib/index.js", "./worker.ts"],
    outfile: "dist/out",
    run: {
      stdout: '{"main":true,"worker":{"build":"commonjs","isMain":false}}',
      file: "dist/out",
      setCwd: true,
    },
  });
});
