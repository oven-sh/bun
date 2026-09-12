import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "path";
import { itBundled } from "./expectBundled";

// These cases are not in bundler_compile.test.ts. That file takes about 230 s on Windows arm64,
// and the test runner stops a bundler_compile file at 300 s.
describe("bundler", () => {
  // An executable runs its first entry point as the main module. In a Worker, import.meta.main is
  // false, as with `bun run`. This is true for the worker's own entry point, and for the copy of the
  // first entry point that the worker's bundle holds because the worker imports it.
  for (const format of ["esm", "cjs"] as const) {
    itBundled("compile/ImportMetaMainInWorker+" + format, {
      backend: "cli",
      compile: true,
      format,
      files: {
        "/entry.ts": /* js */ `
          export function isMain() {
            return import.meta.main;
          }
          if (Bun.isMainThread) {
            const worker = new Worker("./worker.ts");
            worker.onmessage = event => {
              console.log(JSON.stringify({ main: import.meta.main, ...event.data }));
              worker.terminate();
            };
          }
        `,
        "/worker.ts": /* js */ `
          import { isMain } from "./entry.ts";
          postMessage({ worker: import.meta.main, entryInWorker: isMain() });
        `,
      },
      entryPointsRaw: ["./entry.ts", "./worker.ts"],
      outfile: "dist/out",
      run: { stdout: '{"main":true,"worker":false,"entryInWorker":false}', file: "dist/out", setCwd: true },
    });
  }
  // With --splitting, the first entry point's module moves to a shared chunk when another entry
  // point imports it. In the main thread, it is still the main module.
  itBundled("compile/ImportMetaMainInWorker+splitting", {
    backend: "cli",
    compile: true,
    splitting: true,
    files: {
      "/entry.ts": /* js */ `
        if (Bun.isMainThread) {
          const worker = new Worker("./worker.ts");
          worker.onmessage = event => {
            console.log(JSON.stringify({ main: import.meta.main, ...event.data }));
            worker.terminate();
          };
        }
      `,
      "/worker.ts": /* js */ `
        import "./entry.ts";
        postMessage({ worker: import.meta.main });
      `,
    },
    entryPointsRaw: ["./entry.ts", "./worker.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":true,"worker":false}', file: "dist/out", setCwd: true },
  });
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
  // The bundler lowers `require.main === module` to `import.meta.main`. So a CommonJS Worker entry
  // point also sees false, as in the output of `Bun.build` and `bun build --outdir`.
  itBundled("compile/RequireMainInCommonJSWorker", {
    backend: "cli",
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        const worker = new Worker("./worker.cjs");
        worker.onmessage = event => {
          console.log(JSON.stringify({ main: require.main === module, worker: event.data }));
          worker.terminate();
        };
      `,
      "/worker.cjs": /* js */ `postMessage(require.main === module);`,
    },
    entryPointsRaw: ["./entry.ts", "./worker.cjs"],
    outfile: "dist/out",
    run: { stdout: '{"main":true,"worker":false}', file: "dist/out", setCwd: true },
  });
  // An entry point that another entry point imports is copied into the bundle of that entry point.
  // The copy is not the main module. The first entry point keeps the inlined `true`.
  for (const format of ["esm", "cjs"] as const) {
    itBundled("compile/ImportMetaMainEntryImportedByOtherEntry+" + format, {
      backend: "cli",
      compile: true,
      format,
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
  }
  // `Bun.build({ compile })` does not inline `import.meta.main` in its entry points, but the copy is `false` there too.
  test("Bun.build: a copy of an entry point in the bundle of another entry point is not the main module", async () => {
    using dir = tempDir("compile-import-meta-main-api", {
      "entry.ts": `import lib from "./lib.cjs";\nconsole.log(JSON.stringify(lib));`,
      "lib.cjs": `module.exports = { isMain: require.main === module };`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts"), join(String(dir), "lib.cjs")],
      compile: { outfile: join(String(dir), "app") },
    });
    expect(result.success).toBe(true);

    await using proc = Bun.spawn({ cmd: [result.outputs[0].path], env: bunEnv, stdout: "pipe", stderr: "inherit" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe('{"isMain":false}\n');
    expect(exitCode).toBe(0);
  });
  // The main module is the first server-side JavaScript entry point. An HTML entry point is for
  // the browser, and a CSS entry point has no JavaScript. With one JavaScript entry point, the
  // parser still drops the branch that cannot run.
  itBundled("compile/ImportMetaMainAfterHtmlAndCssEntryPoints", {
    backend: "cli",
    compile: true,
    files: {
      "/index.html": /* html */ `<!doctype html><html><head><script type="module" src="./client.ts"></script></head></html>`,
      "/client.ts": /* js */ `console.log("client");`,
      "/style.css": /* css */ `body { color: red; }`,
      "/server.ts": /* js */ `
        const branch = () => {
          if (!import.meta.main) return "not main";
        };
        console.log(JSON.stringify({ main: import.meta.main, folded: !branch.toString().includes("not main") }));
      `,
    },
    entryPointsRaw: ["./index.html", "./style.css", "./server.ts"],
    outfile: "dist/out",
    run: { stdout: '{"main":true,"folded":true}', file: "dist/out", setCwd: true },
  });
});
