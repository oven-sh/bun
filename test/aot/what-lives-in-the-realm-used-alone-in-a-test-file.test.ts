import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// In a layered test run the program of a test file is built over others, and what lives in the realm was made by the first of them: the standard streams, the two ends of a
// TransformStream, the headers of a Response. The program of the test file must not take such an object for one that its own copy of the library made.
// What else a program uses changes what the compiler believes of these objects: with node:stream used beside it, `process.stdout.write` was right, and alone it ended the process.
// So each use stands alone in a test file, which is a program of its own here.
const uses = [
  `process.stdout.write("")`,
  `process.stderr.write("")`,
  `process.stdout.write("", () => {})`,
  `process.stdout.on("drain", () => {}).listenerCount("drain")`,
  `process.stderr.once("x", () => {}).listenerCount("x")`,
  `process.stderr.eventNames()`,
  `process.stdout.getMaxListeners()`,
  `process.stderr.closed`,
  `process.stdout.destroyed`,
  `process.stderr.writableBuffer`,
  `process.stderr.errored`,
  `process.stdout._writableState.objectMode`,
  `process.stdin.closed`,
  `process.stdin.readableFlowing`,
  `process.stdin.readableBuffer`,
  `process.argv.length > 0`,
  `typeof process.env.PATH`,
  `Bun.stdout.size >= 0`,
  `new TransformStream().readable.locked`,
  `new TransformStream().writable.getWriter().desiredSize`,
  `new TextEncoderStream().readable.locked`,
  `new Response("a").headers.get("content-type")`,
  `new Request("http://x/", { headers: { a: "b" } }).headers.get("a")`,
  `new URL("http://a/?b=1").searchParams.get("b")`,
  `new AbortController().signal.aborted`,
];

// Tests of the type come first: where the compiler believed something else of the value, it had decided them, and "boolean" was printed for false.
const say = `function say(v: any): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "function") return "function";
  if (t !== "object") return t === "boolean" || t === "number" || t === "string" ? t + " " + String(v) : t;
  return Object.prototype.toString.call(v);
}`;

test("each is as in plain bun test", async () => {
  using dir = tempDir(
    "aot-what-lives-in-the-realm",
    Object.fromEntries([
      ["package.json", `{ "name": "alone", "type": "module" }`],
      ...uses.map((use, index) => [
        `use-${String(index).padStart(2, "0")}.test.ts`,
        `import { test } from "bun:test";\n${say}\ntest("use", () => {\n  let seen: string;\n  try {\n    seen = say(${use});\n  } catch (error) {\n    seen = "throws " + (error as Error).name;\n  }\n  console.log("RESULT|${index}|" + seen);\n});\n`,
      ]),
    ]),
  );
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", "--parallel=8", ...flags],
      String(dir),
      { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
    );
    // With --parallel what a worker prints comes by way of the runner.
    const results = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("RESULT|"));
    return {
      results: results.sort(),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
      exitCode,
    };
  };
  const [plain, layers] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain.results.length).toBe(uses.length);
  expect(plain.failed).toEqual([]);
  expect(layers).toEqual(plain);
}, 120_000);
