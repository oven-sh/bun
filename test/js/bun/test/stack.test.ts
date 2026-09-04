import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, normalizeBunSnapshot } from "harness";
import { join } from "node:path";

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

// Once error.stack has been read (or assigned), JSC no longer has the frames of
// the error, and Bun.inspect / console.error / the uncaught error output print
// the frames parsed back out of that string instead.
describe("printing the frames parsed back out of error.stack", () => {
  const printedFrames = (text: string) =>
    text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("at "));

  // "at async outer (/x.js:1:2)" -> "at async outer": where the frames point is
  // not what is being tested here.
  const withoutLocation = (line: string) => line.replace(/ \(.*$/, "");

  test("async, <anonymous>, new and bare frames print as they do in error.stack", () => {
    const err = new Error("boom");
    err.stack = [
      "Error: boom",
      "    at async fetchUser (/fake/api.js:10:9)",
      "    at async <anonymous> (/fake/app.js:4:3)",
      "    at <anonymous> (/fake/app.js:9:1)",
      "    at new Client (/fake/client.js:2:11)",
      "    at run (/fake/main.js:7:5)",
      "    at global code (/fake/main.js:12:1)",
      "    at unknown",
    ].join("\n");

    const expected = [
      "at async fetchUser (/fake/api.js:10:9)",
      "at async <anonymous> (/fake/app.js:4:3)",
      "at <anonymous> (/fake/app.js:9:1)",
      "at new Client (/fake/client.js:2:11)",
      "at run (/fake/main.js:7:5)",
      "at /fake/main.js:12:1",
      expect.stringMatching(/^at unknown\b/),
    ];
    expect(printedFrames(Bun.inspect(err, { colors: false }))).toEqual(expected);
    expect(printedFrames(Bun.stripANSI(Bun.inspect(err, { colors: true })))).toEqual(expected);
  });

  test("Bun.inspect prints the same frames before and after error.stack has been read", async () => {
    async function inner() {
      await 1;
      throw new Error("boom");
    }
    async function outer() {
      await inner();
    }
    const err: Error = await (async () => {
      await outer();
    })().catch(e => e);

    const ownFrames = (text: string) =>
      printedFrames(text)
        .filter(line => line.includes("stack.test.ts"))
        .map(withoutLocation);
    const before = ownFrames(Bun.inspect(err));
    const stack = ownFrames(err.stack!);
    const after = ownFrames(Bun.inspect(err));

    expect(before).toEqual(["at inner", "at async outer", "at async <anonymous>"]);
    expect({ stack, after }).toEqual({ stack: before, after: before });
  });

  test("console.error and the unhandled rejection output keep the async frames", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          async function inner() {
            await 1;
            throw new Error("boom");
          }
          async function outer() {
            await inner();
          }
          (async () => {
            await outer();
          })().catch(e => {
            e.stack; // e.g. a logger reading it
            console.error(e);
            throw e;
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Printed once by console.error(e) and once as an unhandled rejection.
    const expected = ["at inner", "at async outer", "at async <anonymous>"];
    expect(printedFrames(stderr).map(withoutLocation)).toEqual([...expected, ...expected]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
