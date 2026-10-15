/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * run() reads the results of a test file from the stdout that the file also
 * prints to. Node splits that stream on bytes, so a line that a test prints
 * is test:stdout and never a result:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/test_runner/runner.js#L430-L486
 */
import assert from "node:assert";
import { once } from "node:events";
import { connect } from "node:net";
import path from "node:path";
import { describe, run, test } from "node:test";
import { fileURLToPath } from "node:url";
import { printed } from "./fixtures/run-output/texts.mjs";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "run-output");

type Verdict = { verdict: string; name: string; linesBefore: number };

// What a script that calls run() sees of one file: the lines the file printed,
// the result of each test with the count of lines that were there before it,
// and the counts of the run. Node reports the text in the chunks it reads, and
// a result after later text, so only this much is the same in both.
async function results(file: string, form: "for await" | "listeners" = "for await") {
  const stream = run({ files: [path.join(fixtures, file)], cwd: fixtures });
  let text = "";
  const verdicts: Verdict[] = [];
  let counts: Record<string, number> | undefined;
  let ends = 0;
  // Bun's first line names the build.
  const lines = () => text.split("\n").filter(line => line.length > 0 && !line.startsWith("bun test v"));
  const take = (type: string, data: any) => {
    if (type === "test:stdout") {
      text += data.message;
    } else if (type === "test:pass" || type === "test:fail") {
      // The file itself is a test with the path as its name.
      verdicts.push({ verdict: type.slice(5), name: path.basename(data.name), linesBefore: lines().length });
    } else if (type === "test:summary" && data.file === undefined) {
      counts = { tests: data.counts.tests, passed: data.counts.passed, failed: data.counts.failed };
    }
  };
  if (form === "for await") {
    for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) take(type, data);
  } else {
    for (const type of ["test:stdout", "test:pass", "test:fail", "test:summary"]) {
      stream.on(type, (data: any) => take(type, data));
    }
    stream.on("end", () => ends++);
    stream.resume();
    await once(stream, "close");
  }
  return { lines: lines(), verdicts, counts, ends };
}

// Only in Bun: a debug or ASAN build takes seconds to start the process of a file.
const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;
const timeout = harness?.isDebug || harness?.isASAN ? 60_000 : undefined;

// Node.js runs the four at once. Each of them starts a process.
describe("what a test file prints is not a result", { concurrency: true }, () => {
  test("from console.log, process.stdout.write, fs.writeSync and a child process", { timeout }, async () => {
    const { lines, verdicts, counts } = await results("prints-fixture.mjs");
    assert.deepStrictEqual(
      {
        lines,
        verdicts: verdicts.map(({ verdict, name }) => verdict + " " + name),
        // The lines of a test are there before its result.
        early: verdicts.map(({ linesBefore }, index) => linesBefore >= Math.min(index + 1, 4) * printed.length),
        counts,
      },
      {
        lines: [...printed, ...printed, ...printed, ...printed, "open: " + printed[0]],
        verdicts: [
          "pass console.log",
          "pass process.stdout.write",
          "pass fs.writeSync",
          "pass a child process",
          "pass an open line",
          "pass passes",
        ],
        early: [true, true, true, true, true, true],
        counts: { tests: 6, passed: 6, failed: 0 },
      },
    );
  });

  test("the name of a stream event does not reach the listeners of the stream", { timeout }, async () => {
    // A script that counts test:fail in a listener and stops at "end" must see these failures.
    assert.deepStrictEqual(await results("names-fixture.mjs", "listeners"), {
      lines: printed.slice(4, 8),
      verdicts: [
        { verdict: "pass", name: "prints", linesBefore: 4 },
        { verdict: "fail", name: "fails", linesBefore: 4 },
        { verdict: "fail", name: "f\u00e4ils \u00ff\u00fe", linesBefore: 4 },
        { verdict: "fail", name: "fails \u{1f600}", linesBefore: 4 },
      ],
      counts: { tests: 4, passed: 1, failed: 3 },
      ends: 1,
    });
  });

  test("a script that only prints is a file that passed", { timeout }, async () => {
    assert.deepStrictEqual(await results("script-fixture.mjs"), {
      lines: [printed[1]],
      verdicts: [{ verdict: "pass", name: "script-fixture.mjs", linesBefore: 1 }],
      counts: { tests: 1, passed: 1, failed: 0 },
      ends: 0,
    });
  });

  test(
    "results arrive while the file runs, from a file that removed JSON, TextEncoder and Error.isError",
    { timeout },
    async () => {
      const stream = run({ files: [path.join(fixtures, "stream-fixture.mjs")], cwd: fixtures });
      const log: string[] = [];
      let port = 0;
      for await (const { type, data } of stream as AsyncIterable<{ type: string; data: any }>) {
        if (type === "test:stdout") {
          const match = /port (\d+)/.exec(data.message);
          if (match) port = Number(match[1]);
        } else if ((type === "test:pass" || type === "test:fail") && !data.name.endsWith(".mjs")) {
          log.push([type.slice(5), data.name, JSON.stringify(data.tags), data.details.error?.message ?? ""].join(" "));
          // The second test of the file ends when something connects.
          if (data.name === "first") connect(port, "127.0.0.1").on("error", () => {});
        }
      }
      assert.deepStrictEqual(log, ["pass first [] ", "pass second [] ", "fail third [] after the changes"]);
    },
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness !== undefined) {
  const { bunEnv, nodeExe } = harness;
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", { timeout }, async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
