import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Runtime proof that side effects under `!`/`typeof` are preserved by the
// simplifier. Transpiler-output assertions live in transpiler.test.js.

test("side effects inside ![...] / typeof [...] run at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let n = 0; const fx = () => { n++; return 1 }; ` +
        `const a = ![fx()]; const b = !{ x: fx() }; const c = typeof [fx()]; ` +
        `const d = !(fx(), true); const e = !typeof fx(); ` +
        `console.log(n, a, b, c, d, e);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("5 false false object false false\n");
  expect(exitCode).toBe(0);
});

// A read of a name that nothing defines throws a ReferenceError, and a feature
// test such as `try { document } catch {}` relies on it. A minifier assumes
// that every browser API exists and drops the read. Bun does not define most
// of them, so the runtime transpiler keeps it. Node.js prints the same for
// each of these files.
describe.concurrent("a read of a browser global that Bun does not define", () => {
  const featureTests = /* js */ `
    const probe = f => {
      try {
        f();
        return "no throw";
      } catch (e) {
        return e.name;
      }
    };
    const id = x => x;
    console.log(
      JSON.stringify({
        statement: probe(() => { document; }),
        void: probe(() => { void requestAnimationFrame; }),
        not: probe(() => { !HTMLElement; }),
        comma: probe(() => (indexedDB, 1)),
        if: probe(() => { if (location) {} }),
        conditional: probe(() => { XMLHttpRequest ? 1 : 2; }),
        logical: probe(() => { customElements || 1; }),
        nullish: probe(() => { SVGElement ?? 1; }),
        equality: probe(() => { CSSStyleSheet === 1; }),
        array: probe(() => { [history]; }),
        object: probe(() => { ({ a: screen }); }),
        index: probe(() => [1, frames][0]),
        pure: probe(() => { /* @__PURE__ */ id(Image); }),
        window: probe(() => { window; }),
        notInTable: probe(() => { madeUpName; }),
        typeof: probe(() => { typeof document; }),
        everywhere: probe(() => { Math; void URL; !setTimeout; }),
        definedInBun: probe(() => { fetch; void navigator; !Blob; }),
      }),
    );
  `;
  const expected = {
    statement: "ReferenceError",
    void: "ReferenceError",
    not: "ReferenceError",
    comma: "ReferenceError",
    if: "ReferenceError",
    conditional: "ReferenceError",
    logical: "ReferenceError",
    nullish: "ReferenceError",
    equality: "ReferenceError",
    array: "ReferenceError",
    object: "ReferenceError",
    index: "ReferenceError",
    pure: "ReferenceError",
    window: "ReferenceError",
    notInTable: "ReferenceError",
    typeof: "no throw",
    everywhere: "no throw",
    definedInBun: "no throw",
  };

  async function run(args: string[], files: Record<string, string> = {}) {
    using dir = tempDir("browser-global-read", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.each([
    ["an ES module", ["features.mjs"]],
    ["a CommonJS module", ["features.cjs"]],
    ["a module that import() loads", ["import.mjs"]],
    ["a module that require() loads", ["require.cjs"]],
    ["a Worker", ["worker.mjs"]],
    ["bun -e", ["-e", featureTests]],
  ])("throws in %s", async (_, args) => {
    const { stdout, stderr, exitCode } = await run(args, {
      "features.mjs": featureTests,
      "features.cjs": featureTests,
      "import.mjs": `await import("./features.mjs");`,
      "require.cjs": `require("./features.cjs");`,
      "worker.mjs": /* js */ `
        const worker = new Worker(new URL("./features.mjs", import.meta.url));
        worker.addEventListener("error", event => {
          console.error(event.message);
          process.exit(1);
        });
      `,
    });
    expect({ result: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: expected,
      stderr: "",
      exitCode: 0,
    });
  });

  test("follows the global object as the program changes it", async () => {
    const { stdout, stderr, exitCode } = await run(["lifecycle.cjs"], {
      "lifecycle.cjs": /* js */ `
        const read = () => {
          try {
            document;
            return "defined";
          } catch (e) {
            return e.name;
          }
        };
        const out = { absent: read() };
        globalThis.document = {};
        out.assigned = read();
        delete globalThis.document;
        out.deleted = read();

        let gets = 0;
        Object.defineProperty(globalThis, "document", { get: () => ++gets, configurable: true });
        document;
        void document;
        !document;
        if (document) {
        }
        out.getterCalls = gets;
        delete globalThis.document;

        const { fetch: savedFetch } = globalThis;
        delete globalThis.fetch;
        try {
          fetch;
          out.deletedBuiltin = "defined";
        } catch (e) {
          out.deletedBuiltin = e.name;
        }
        globalThis.fetch = savedFetch;

        // The first of two missing globals throws.
        try {
          const a = document;
          out.first = [location, a];
        } catch (e) {
          out.first = e.message;
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect({ result: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: {
        absent: "ReferenceError",
        assigned: "defined",
        deleted: "ReferenceError",
        getterCalls: 4,
        deletedBuiltin: "ReferenceError",
        first: "document is not defined",
      },
      stderr: "",
      exitCode: 0,
    });
  });
});
