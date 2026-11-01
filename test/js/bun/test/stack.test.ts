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

/** What the error printer shows of one error: the source lines above the message, and the frames below it. */
function shown(printed: string, root: string) {
  const lines = printed.replaceAll(root + sep, "").split("\n");
  let sourceLines = 0;
  while (sourceLines < lines.length && /^\s*(\d+ \| .*|\^)$/.test(lines[sourceLines])) sourceLines++;
  return {
    lines: lines.slice(0, sourceLines),
    at: lines.filter(line => line.trimStart().startsWith("at ")),
  };
}

// JavaScriptCore's parser is the one that rejects second.ts: the bundler passes a regular expression literal through.
// The source map of a bundle names second.ts for the line of the error, and the file that is loaded is the bundle.
describe.concurrent("a SyntaxError from JavaScriptCore's parser in a file with a source map", () => {
  const sources = {
    "first.ts": "export const first = 1;\n",
    "second.ts": "export const a = 1;\nexport const b = 2;\nexport const re = /(/;\n",
    "entry.ts": 'import { first } from "./first.ts";\nimport { re } from "./second.ts";\nconsole.log(first, re);\n',
  };
  // What an error says about where it is: its properties, and the "at <parse>" line of its stack if it has one.
  const locate = /* js */ `
    const { relative } = require("node:path");
    function locate(e) {
      const sourceURL = relative(__dirname, e.sourceURL).replaceAll("\\\\", "/");
      const parse = String(e.stack).split("\\n").find(line => line.includes("at <parse>"));
      return { sourceURL, line: e.line, originalLine: e.originalLine, stack: parse?.trim().replace(e.sourceURL, sourceURL) };
    }
    function thrownBy(file) {
      try {
        require("./" + file);
      } catch (e) {
        return e;
      }
    }
  `;

  type Options = Pick<Bun.BuildConfig, "sourcemap" | "format" | "minify"> & { entry?: string };
  /** Builds entry.ts into the folder `name`. Returns the line of the bundle that has `text`. */
  async function bundle(root: string, name: string, { entry = "entry.ts", ...options }: Options, text = "/(/") {
    const { outputs } = await Bun.build({
      entrypoints: [join(root, entry)],
      outdir: join(root, name),
      target: "bun",
      ...options,
    });
    const output = await outputs.find(output => output.kind === "entry-point")!.text();
    return output.split("\n").findIndex(line => line.includes(text)) + 1;
  }

  async function run(cwd: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.cjs"], env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("has the line and the sourceURL of one file", async () => {
    using dir = tempDir("parser-error-location", {
      ...sources,
      "throws.ts": 'export const a = 1;\nexport const b = 2;\nthrow new TypeError("thrown");\n',
      "transpiled.ts":
        "type T = { a: number };\ninterface I { b: string }\nconst a: T = { a: 1 };\nconst re = /(/;\nexport { a, re };\n",
      "unmapped.js": "// @bun\nconst a = 1;\nconst b = 2;\nconst re = /(/;\n",
      // The source map has a mapping for line 2 and none for the line of the error.
      "partly-mapped.js": "// @bun\nconst a = 1;\nconst b = 2;\nconst re = /(/;\n",
      "partly-mapped.js.map": JSON.stringify({
        version: 3,
        sources: ["other.ts"],
        sourcesContent: [""],
        names: [],
        mappings: ";AAAA",
      }),
      "main.cjs": /* js */ `
        ${locate}
        (async () => {
          const locations = {};
          const files = ["linked/entry.js", "inline/entry.js", "cjs/entry.js", "unmapped.js", "partly-mapped.js", "transpiled.ts", "throws/throws.js"];
          const errors = Object.fromEntries(files.map(file => [file, thrownBy(file)]));
          for (const file of files) locations[file] = locate(errors[file]);

          const imported = await import("./imported/entry.js").catch(e => e);
          locations["imported/entry.js"] = locate(imported);
          // The frames are alive while this function runs, so no collection formats them first.
          Error.captureStackTrace(imported);
          locations["imported/entry.js, with frames"] = locate(imported);

          const clone = structuredClone(errors["linked/entry.js"]);
          Error.captureStackTrace(clone);
          locations["a clone of linked/entry.js, with frames"] = locate(clone);

          Error.prepareStackTrace = () => "";
          const prepared = thrownBy("prepared/entry.js");
          Error.prepareStackTrace = undefined;
          locations["prepared/entry.js, under Error.prepareStackTrace"] = locate(prepared);

          console.log(JSON.stringify(locations));
        })();
      `,
    });
    const root = String(dir);
    // The line of each bundle that has the error.
    const line = {
      linked: await bundle(root, "linked", { sourcemap: "linked" }),
      inline: await bundle(root, "inline", { sourcemap: "inline" }),
      cjs: await bundle(root, "cjs", { sourcemap: "linked", format: "cjs" }),
      imported: await bundle(root, "imported", { sourcemap: "linked" }),
      prepared: await bundle(root, "prepared", { sourcemap: "linked" }),
      throws: await bundle(root, "throws", { sourcemap: "linked", entry: "throws.ts" }, "thrown"),
    };

    const { stdout, stderr, exitCode } = await run(root);

    // `line` is a line of second.ts, so `sourceURL` is second.ts. `originalLine` is the line before the source map.
    const inSecond = (originalLine: number) => ({
      sourceURL: "second.ts",
      line: 3,
      originalLine,
      stack: "at <parse> (second.ts:3)",
    });
    // No source map gives another file for the line: both are the ones of the file that was loaded.
    const inLoaded = (file: string, line: number) => ({
      sourceURL: file,
      line,
      originalLine: line,
      stack: `at <parse> (${file}:${line})`,
    });
    expect({ locations: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      locations: {
        "linked/entry.js": inSecond(line.linked),
        "inline/entry.js": inSecond(line.inline),
        "cjs/entry.js": inSecond(line.cjs),
        "unmapped.js": inLoaded("unmapped.js", 4),
        "partly-mapped.js": inLoaded("partly-mapped.js", 4),
        // Bun's own source map of a file that it transpiles names that file.
        "transpiled.ts": {
          sourceURL: "transpiled.ts",
          line: 4,
          originalLine: 2,
          stack: "at <parse> (transpiled.ts:4)",
        },
        // An error that has frames takes both from its first frame.
        "throws/throws.js": { sourceURL: "throws.ts", line: 3, originalLine: line.throws },
        // A module is parsed with no JS frame on the stack. Nothing maps its error until it has frames.
        "imported/entry.js": { sourceURL: "imported/entry.js", line: line.imported },
        "imported/entry.js, with frames": inSecond(line.imported),
        // A structured clone starts from the line and the sourceURL of the error. They are not mapped a second time.
        "a clone of linked/entry.js, with frames": inSecond(3),
        // A callable Error.prepareStackTrace makes the stack, and nothing maps the error.
        "prepared/entry.js, under Error.prepareStackTrace": { sourceURL: "prepared/entry.js", line: line.prepared },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The line is looked up at column 0. A minified bundle has its modules on one line, and the first mapping of that
  // line is in first.ts, so the error says first.ts:1. The parser knows the column: https://github.com/oven-sh/bun/issues/5192
  test.failing("names the module that has the error when the bundle is minified", async () => {
    using dir = tempDir("parser-error-minified", {
      ...sources,
      "main.cjs": `${locate}\nconsole.log(JSON.stringify(locate(thrownBy("minified/entry.js"))));`,
    });
    const root = String(dir);
    const line = await bundle(root, "minified", { sourcemap: "linked", minify: true });

    const { stdout, stderr, exitCode } = await run(root);
    expect({ location: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      location: { sourceURL: "second.ts", line: 3, originalLine: line, stack: "at <parse> (second.ts:3)" },
      stderr: "",
      exitCode: 0,
    });
  });

  test("is printed at that location when the printer has only its properties to read", async () => {
    using dir = tempDir("parser-error-printed", {
      ...sources,
      "main.cjs": /* js */ `
        try {
          require("./out/entry.js");
        } catch (e) {
          // Neither has frames to print: the error has no stack now, and an object made from it is not an Error.
          e.stack = "";
          console.log(Bun.inspect(e, { colors: false }));
          throw Object.create(e);
        }
      `,
    });
    const root = String(dir);
    await bundle(root, "out", { sourcemap: "linked" });

    const { stdout, stderr, exitCode } = await run(root);
    expect({ error: shown(stdout, root), object: shown(stderr, root), exitCode }).toEqual({
      error: {
        lines: ["1 | export const a = 1;", "2 | export const b = 2;", "3 | export const re = /(/;", "    ^"],
        at: ["      at second.ts:3:1"],
      },
      // The printer reads the file that an Error names, and not the file that another object names.
      object: { lines: [], at: ["      at second.ts:3"] },
      exitCode: 1,
    });
  });
});

test("an object with the properties of an error is printed at the line of the error", async () => {
  // The lines of types are not in the text that runs. The error is on line 6, which is line 2 before the source map.
  using dir = tempDir("error-properties-location", {
    "thrower.ts": `type A = { a: number };
interface B {
  b: string;
}
const value: A = { a: 1 };
const error = new Error("boom " + value.a);
throw Object.create(Error.prototype, Object.getOwnPropertyDescriptors(error));
`,
  });
  const root = String(dir);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "thrower.ts"],
    env: bunEnv,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, shown: shown(stderr, root), exitCode }).toEqual({
    stdout: "",
    shown: { lines: [], at: ["      at thrower.ts:6"] },
    exitCode: 1,
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
