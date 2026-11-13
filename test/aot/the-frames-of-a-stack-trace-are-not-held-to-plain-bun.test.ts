// run-parallel.ts: a program that differs from its reference in the frames of stack traces alone passes, and its line says so. Whatever else differs fails it: a message, a value beside a frame,
// a line that plain Bun prints the same whatever the frames are, though the second build agrees, and whatever only looks like a place: `sum:42`, `1:2`, `12:30`, `{a:1}`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const head = [
  `const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.includes("~BUN");`,
  `function top() { return new Error("m").stack.split("\\n")[1].trim().split(" ")[1]; }`,
  // As where a function was renamed and only plain Bun shows the new name.
  `const shown = top() === "top" && compiled ? "renamed" : top();`,
  `const isFirstBuild = top() === "top";`,
  ``,
].join("\n");
const differs = "compare: it does not exit and print as plain Bun does";
const programs = {
  "frames-in-lines.js": [
    `console.log("Error: the message\\n    at " + (compiled ? "one (a.js:1:1)" : "other (b.js:2:2)\\n    at more (c.js:3:3)"));`,
    "pass, the frames differ",
  ],
  "places-behind-the-name-of-a-file.js": [
    `console.log("leaf " + (compiled ? "/$bunfs/root/main.js:3:14 < main.js:5" : "/folder/main.js:4:15 < main.js:6:2"));`,
    "pass, the frames differ",
  ],
  // The line and the column of the top frame, as where the two show another place.
  "places-out-of-frames-as-data.js": [
    `const place = /(\\d+:\\d+)\\)?$/.exec(new Error("m").stack.split("\\n")[1])[1];\nconsole.log("thrown at " + (compiled && isFirstBuild ? "9:9" : place));`,
    "pass, the frames differ",
  ],
  "names-as-data.js": [`console.log("the top frame: " + shown);`, "pass, the frames differ"],
  "the-same.js": [`console.log("the top frame: " + top());`, "pass"],
  "message-differs.js": [
    `console.log("Error: " + (compiled ? "one message" : "another message") + "\\n    at f (a.js:1:1)");`,
    differs,
  ],
  "message-differs-beside-names.js": [
    `console.log("the top frame: " + shown + " | " + (compiled ? "one message" : "another message"));`,
    differs,
  ],
  "value-differs-in-another-line.js": [
    `console.log("the top frame: " + shown);\nconsole.log("a value: " + (compiled ? 1 : 2));`,
    differs,
  ],
  "only-the-first-build-differs.js": [`console.log("a value: " + (compiled && isFirstBuild ? 1 : 2));`, differs],
  // In the second build the program is not the entry point, so both sides print another line there, and it holds no frame.
  "asks-for-the-entry-point.js": [
    `console.log("the main module: " + (compiled && isFirstBuild ? "none" : typeof require.main));`,
    differs,
  ],
  "exit-code-differs.js": [
    `console.log("the top frame: " + shown);\nif (compiled && isFirstBuild) process.exit(3);`,
    differs,
  ],
  "stored-frames.js": [
    `console.log("Error: the message\\n    at real (x.js:9:9)");\n/* Output:\nError: the message\n    at stored (y.js:1:1)\n    at another (z.js:2:2)\n*/`,
    "pass, the frames differ",
  ],
  "stored-message.js": [
    `console.log("Error: the message\\n    at real (x.js:9:9)");\n/* Output:\nError: another message\n    at real (x.js:9:9)\n*/`,
    "compare: it does not print what its last comment says",
  ],
  // What looks like a place and is an answer of the program.
  "a-number-behind-a-name.js": [`console.log("sum:" + (compiled ? 42 : 41));`, differs],
  "numbers-behind-names.js": [`console.log(compiled ? "x:1 y:2" : "x:9 y:8");`, differs],
  "a-ratio.js": [`console.log("ratio 1:" + (compiled ? 2 : 3));`, differs],
  "a-time.js": [
    `console.log("  at 12:" + (compiled ? 30 : 31) + " it rang");\nconsole.log("  at 12:" + (compiled ? 30 : 31));`,
    differs,
  ],
  "an-object.js": [`console.log("{a:" + (compiled ? 1 : 2) + "}");`, differs],
  "a-number-behind-a-bracket.js": [`console.log("[a]:" + (compiled ? 5 : 6));`, differs],
  "numbers-in-a-row.js": [`console.log("3:0:1:" + (compiled ? 7 : 8));`, differs],
  "a-row-of-a-table.js": [`console.log("1 | " + (compiled ? 2 : 3));`, differs],
  "a-value-beside-a-place.js": [`console.log(compiled ? "main.js:3:14 gave 5" : "main.js:4:15 gave 6");`, differs],
  "marked.js": [
    `// Todo: only frames (stack-trace-only differences are fine): for the test\nconsole.log("a value: " + (compiled ? 1 : 2));`,
    "skip: todo: only frames (stack-trace-only differences are fine): for the test",
  ],
  "stored-number-behind-a-name.js": [
    `console.log("sum:42");\n/* Output:\nsum:41\n*/`,
    "compare: it does not print what its last comment says",
  ],
} as const;

test("the frames of a stack trace are not held to plain Bun", async () => {
  using dir = tempDir("the-frames-of-a-stack-trace", {
    "tsconfig.json": "{}",
    // A line that says how the program is judged stands at the top.
    ...Object.fromEntries(
      Object.entries(programs).map(([name, [text]]) => [
        name,
        (text.startsWith("//") ? text.replace("\n", "\n" + head) : head + text) + "\n",
      ]),
    ),
  });
  const root = String(dir);
  const files = Object.keys(programs).map(name => join(root, name));
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=4", "--no-erased", ...files],
    root,
    bunEnv,
  );
  const verdicts = Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message, framesDiffer }) => [
        file.slice(root.length + 1).replaceAll("\\", "/"),
        state === "pass"
          ? framesDiffer
            ? "pass, the frames differ"
            : "pass"
          : `${state === "skip" ? "skip" : stage}: ${message}`,
      ]),
  );
  expect(verdicts).toEqual(Object.fromEntries(Object.entries(programs).map(([name, [, verdict]]) => [name, verdict])));
  expect(stderr).toContain(
    "5 builds differ from their reference in the frames of stack traces alone, and pass | 1 programs are skipped because",
  );
  expect(exitCode).toBe(1);
}, 240_000);
