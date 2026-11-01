import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, normalizeBunSnapshot, tempDir } from "harness";
import { join, sep } from "node:path";

test("name property is used for function calls in Error.stack", () => {
  function WRONG() {
    return new Error().stack;
  }
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT" });
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test("name property is used for function calls in Bun.inspect", () => {
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  function WRONG() {
    try {
      throw new Error();
    } catch (e) {
      return Bun.inspect(e);
    }
  }
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT" });
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test.todo("name property is used for function calls in Bun.inspect with bound object", () => {
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  let WRONG = function WRONG() {
    try {
      throw new Error();
    } catch (e) {
      return Bun.inspect(e);
    }
  };
  WRONG = WRONG.bind({});
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT", writable: true, configurable: true });
  console.log(WRONG());
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test("err.line and err.column are set", async () => {
  expect(await bunRun(join(import.meta.dir, "err-stack-fixture.js"))).toSpawn(
    JSON.stringify(
      {
        line: 3,
        column: 17,
        originalLine: 1,
        originalColumn: 18,
      },
      null,
      2,
    ),
  );
});

// JavaScriptCore's parser is the one that rejects src.ts: the bundler passes a regular expression literal through.
// The source map of a bundle names src.ts, which is not the file that is loaded.
describe.concurrent("a SyntaxError from JavaScriptCore's parser in a file with a source map", () => {
  const source = "export const a = 1;\nexport const b = 2;\nexport const re = /(/;\n";

  /** Builds src.ts into `name`/src.js. Returns the line of the bundle that has the regular expression. */
  async function bundle(root: string, name: string, options: Pick<Bun.BuildConfig, "sourcemap" | "format">) {
    const { outputs } = await Bun.build({
      entrypoints: [join(root, "src.ts")],
      outdir: join(root, name),
      target: "bun",
      ...options,
    });
    const text = await outputs.find(output => output.kind === "entry-point")!.text();
    return text.split("\n").findIndex(line => line.includes("/(/")) + 1;
  }

  async function run(cwd: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.cjs"], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("has the line and the sourceURL of one file", async () => {
    using dir = tempDir("parser-error-location", {
      "src.ts": source,
      "unmapped.js": "// @bun\nconst a = 1;\nconst b = 2;\nconst re = /(/;\n",
      "main.cjs": /* js */ `
        const { relative } = require("node:path");
        const locations = {};
        function locate(file, e) {
          const sourceURL = relative(__dirname, e.sourceURL);
          // The stack names a file too, in its "at <parse>" line.
          const stack = e.stack.split("\\n")[1].trim().replace(e.sourceURL, sourceURL);
          locations[file] = { sourceURL, line: e.line, originalLine: e.originalLine, stack };
        }
        for (const file of ["linked/src.js", "inline/src.js", "cjs/src.js", "unmapped.js"]) {
          try {
            require("./" + file);
          } catch (e) {
            locate(file, e);
          }
        }
        // A module is parsed with no JS frame on the stack. Its error is located once it has frames.
        import("./imported/src.js")
          .catch(e => {
            Error.captureStackTrace(e);
            locate("imported/src.js", e);
          })
          .then(() => console.log(JSON.stringify(locations)));
      `,
    });
    const root = String(dir);
    const generatedLine = {
      linked: await bundle(root, "linked", { sourcemap: "linked" }),
      inline: await bundle(root, "inline", { sourcemap: "inline" }),
      cjs: await bundle(root, "cjs", { sourcemap: "linked", format: "cjs" }),
      imported: await bundle(root, "imported", { sourcemap: "linked" }),
    };

    const { stdout, stderr, exitCode } = await run(root);

    // `line` is a line of src.ts, so `sourceURL` is src.ts. `originalLine` is the line in the file that was loaded.
    const inSource = (originalLine: number) => ({
      sourceURL: "src.ts",
      line: 3,
      originalLine,
      stack: "at <parse> (src.ts:3)",
    });
    expect({ locations: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      locations: {
        "linked/src.js": inSource(generatedLine.linked),
        "inline/src.js": inSource(generatedLine.inline),
        "cjs/src.js": inSource(generatedLine.cjs),
        "imported/src.js": inSource(generatedLine.imported),
        "unmapped.js": { sourceURL: "unmapped.js", line: 4, originalLine: 4, stack: "at <parse> (unmapped.js:4)" },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("is printed at that location when the printer has only its properties to read", async () => {
    using dir = tempDir("parser-error-printed", {
      "src.ts": source,
      "main.cjs": /* js */ `
        try {
          require("./out/src.js");
        } catch (e) {
          // Neither the error without its stack nor an object with its properties has frames to print.
          const copy = { name: e.name, message: e.message, sourceURL: e.sourceURL, line: e.line, originalLine: e.originalLine };
          e.stack = "";
          console.log(Bun.inspect(e, { colors: false }));
          throw copy;
        }
      `,
    });
    const root = String(dir);
    await bundle(root, "out", { sourcemap: "linked" });

    const { stdout, stderr, exitCode } = await run(root);

    // The source lines above the message, and the frame below it.
    const shown = (printed: string) => {
      const lines = printed.replaceAll(root + sep, "").split("\n");
      const message = lines.findIndex(line => line.startsWith("SyntaxError: "));
      return {
        lines: lines.slice(0, Math.max(message, 0)),
        at: lines.filter(line => line.trimStart().startsWith("at ")),
      };
    };
    expect({ error: shown(stdout), copy: shown(stderr), exitCode }).toEqual({
      error: {
        lines: ["1 | export const a = 1;", "2 | export const b = 2;", "3 | export const re = /(/;", "    ^"],
        at: ["      at src.ts:3:1"],
      },
      // The printer does not read the file that an object names, only the one that an Error names.
      copy: { lines: [], at: ["      at src.ts:3"] },
      exitCode: 1,
    });
  });
});

test("throwing inside an error suppresses the error and prints the stack", async () => {
  $.throws(false);
  $.env(bunEnv);
  const result = await $`${bunExe()} run ${join(import.meta.dir, "err-custom-fixture.js")}`;

  const { stderr, exitCode } = result;

  expect(stderr.toString().trim().split("\n").slice(0, -1).join("\n").trim()).toMatchInlineSnapshot(`
"error: My custom error message
{
  message: "My custom error message",
  name: [Getter],
  line: 42,
  sourceURL: "http://example.com/test.js",
}
      at http://example.com/test.js:42"
`);
  expect(exitCode).toBe(1);
});

test("uncaught error thrown from a data: URL module longer than a path buffer is annotated for GitHub Actions", async () => {
  // Longer than a path buffer on every platform (98302 bytes on Windows).
  const padding = 100_000;
  const dataUrlModule = 'export default function fromDataUrl() { throw new Error("boom"); }//';
  const base64 = btoa(dataUrlModule + Buffer.alloc(padding, "x").toString());

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const source = ${JSON.stringify(dataUrlModule)} + Buffer.alloc(${padding}, "x").toString();
       const m = await import("data:text/javascript;base64," + btoa(source));
       m.default();`,
    ],
    env: { ...bunEnv, GITHUB_ACTIONS: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const annotation = stderr.split("\n").find(line => line.startsWith("::error"));
  expect(annotation).toStartWith(`::error file=data%3Atext/javascript;base64%2C${base64},line=1,col=`);
  expect(annotation).toContain(`%0A      at fromDataUrl (data:text/javascript;base64,${base64}:1:`);
  expect(exitCode).toBe(1);
});

test("throwing inside an error suppresses the error and continues printing properties on the object", async () => {
  $.throws(false);
  $.env(bunEnv);
  const result = await $`${bunExe()} run ${join(import.meta.dir, "err-fd-fixture.js")}`;

  const { stderr, exitCode } = result;

  expect(stderr.toString().trim()).toStartWith(`ENOENT: no such file or directory, open 'this-file-path-is-bad'
    path: "this-file-path-is-bad",
 syscall: "open",
   errno: ${process.binding("uv").UV_ENOENT},
    code: "ENOENT"
`);
  expect(exitCode).toBe(1);
});

test("Async functions frame should be included in stack trace", async () => {
  async function foo() {
    return await bar();
  }
  async function bar() {
    return await baz();
  }
  async function baz() {
    await 1;
    return await qux();
  }
  async function qux() {
    return new Error("error from qux");
  }

  const error = await foo();

  console.log(error.stack);

  expect(normalizeBunSnapshot(error.stack!)).toMatchInlineSnapshot(`
    "Error: error from qux
        at qux (file:NN:NN)
        at baz (file:NN:NN)
        at async bar (file:NN:NN)
        at async foo (file:NN:NN)
        at async <anonymous> (file:NN:NN)"
  `);
});
