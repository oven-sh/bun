import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const env = { ...bunEnv, AGENT: "0" };

async function run(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The events of an ndjson file, with paths relative to `dir` and no durations. */
async function readEvents(dir: string, name = "events.ndjson") {
  const root = realpathSync(dir) + "/";
  const text = await Bun.file(join(dir, name)).text();
  return text
    .trimEnd()
    .split("\n")
    .map(line =>
      JSON.parse(line, (key, value) => {
        if (key === "duration") return typeof value;
        if (typeof value === "string") return value.replaceAll(root, "");
        return value;
      }),
    );
}

const fixture = `
import { describe, test, expect } from "bun:test";
describe("math", () => {
  test("adds", () => {
    expect(1 + 1).toBe(2);
  });
  test("objects", () => {
    expect({ a: 1 }).toEqual({ a: 2 });
  });
  describe("nested", () => {
    test.skip("skipped", () => {});
    test.todo("later");
  });
});
let attempts = 0;
test("flaky", () => {
  attempts++;
  expect(attempts).toBe(2);
}, { retry: 1 });
`;

describe("--reporter=ndjson", () => {
  test.concurrent("writes every event of the run, a line each", async () => {
    using dir = tempDir("reporter-ndjson", { "a.test.ts": fixture });
    const result = await run(String(dir), ["--reporter=ndjson", "--reporter-outfile=events.ndjson"]);
    const events = await readEvents(String(dir));

    expect(events.map(event => event.type)).toEqual([
      "runStart",
      "fileStart",
      "fileCollected",
      "testStart",
      "testEnd",
      "testStart",
      "testEnd",
      "testEnd",
      "testEnd",
      "testStart",
      "testStart",
      "testEnd",
      "fileEnd",
      "runEnd",
    ]);
    expect(events[0]).toEqual({ type: "runStart", files: ["a.test.ts"] });
    expect(events[2]).toEqual({
      type: "fileCollected",
      file: "a.test.ts",
      tests: [
        {
          type: "describe",
          id: "d2",
          parentId: null,
          name: "math",
          line: 3,
          column: 1,
          mode: "normal",
          only: false,
          concurrent: false,
        },
        {
          type: "test",
          id: "t2",
          parentId: "d2",
          name: "adds",
          line: 4,
          column: 3,
          mode: "normal",
          only: false,
          concurrent: false,
        },
        {
          type: "test",
          id: "t3",
          parentId: "d2",
          name: "objects",
          line: 7,
          column: 3,
          mode: "normal",
          only: false,
          concurrent: false,
        },
        {
          type: "describe",
          id: "d3",
          parentId: "d2",
          name: "nested",
          line: 10,
          column: 3,
          mode: "normal",
          only: false,
          concurrent: false,
        },
        {
          type: "test",
          id: "t4",
          parentId: "d3",
          name: "skipped",
          line: 11,
          column: 10,
          mode: "skip",
          only: false,
          concurrent: false,
        },
        {
          type: "test",
          id: "t5",
          parentId: "d3",
          name: "later",
          line: 12,
          column: 10,
          mode: "todo",
          only: false,
          concurrent: false,
        },
        {
          type: "test",
          id: "t1",
          parentId: null,
          name: "flaky",
          line: 16,
          column: 1,
          mode: "normal",
          only: false,
          concurrent: false,
        },
      ],
    });

    const ends = Object.fromEntries(
      events.filter(event => event.type === "testEnd").map(event => [event.fullName, event]),
    );
    expect(ends["math > adds"]).toEqual({
      type: "testEnd",
      file: "a.test.ts",
      id: "t2",
      name: "adds",
      fullName: "math > adds",
      parentId: "d2",
      status: "pass",
      duration: "number",
      assertions: 1,
      attempt: 1,
      errors: [],
      earlierAttemptErrors: [],
    });
    expect(ends["math > objects"].status).toBe("fail");
    expect(ends["math > objects"].errors).toEqual([
      {
        name: "AssertionError",
        message: expect.stringContaining("expect(received).toEqual(expected)"),
        stack: expect.stringContaining("at a.test.ts:8:22"),
        expected: "{\n  a: 2,\n}",
        actual: "{\n  a: 1,\n}",
        uncaught: false,
      },
    ]);
    expect(ends["math > nested > skipped"]).toMatchObject({ status: "skip", parentId: "d3" });
    expect(ends["math > nested > later"]).toMatchObject({ status: "todo", parentId: "d3" });
    expect(ends["flaky"]).toMatchObject({ status: "pass", attempt: 2, parentId: null, errors: [] });
    expect(ends["flaky"].earlierAttemptErrors).toEqual([
      expect.objectContaining({ name: "AssertionError", expected: "2", actual: "1" }),
    ]);
    expect(events.filter(event => event.type === "testStart" && event.id === "t1").map(event => event.attempt)).toEqual(
      [1, 2],
    );
    expect(events.at(-2)).toEqual({ type: "fileEnd", file: "a.test.ts", duration: "number", failedToLoad: false });
    expect(events.at(-1)).toEqual({
      type: "runEnd",
      pass: 2,
      fail: 1,
      skip: 1,
      todo: 1,
      filtered: 0,
      files: 1,
      duration: "number",
    });
    // The console reporter still prints.
    expect(result.stderr).toContain("(fail) math > objects");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("reports a failing beforeAll as a hookFailure, and an error outside of tests", async () => {
    using dir = tempDir("reporter-ndjson-hooks", {
      "a.test.ts": `
        import { describe, test, beforeAll } from "bun:test";
        describe("setup", () => {
          beforeAll(() => { throw new Error("no database"); });
          test("uses it", () => {});
        });
        setTimeout(() => { throw new Error("stray"); }, 0);
        test("waits", async () => { await Bun.sleep(20); });
      `,
    });
    const result = await run(String(dir), ["--reporter=ndjson", "--reporter-outfile=events.ndjson"]);
    const events = await readEvents(String(dir));

    const hookFailure = events.find(event => event.type === "hookFailure");
    expect(hookFailure).toMatchObject({
      file: "a.test.ts",
      parentId: "d2",
      status: "fail",
      errors: [expect.objectContaining({ name: "Error", message: "no database" })],
    });
    expect(events.find(event => event.type === "unhandledError")).toMatchObject({
      file: "a.test.ts",
      error: expect.objectContaining({ name: "Error", message: "stray" }),
    });
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("requires --reporter-outfile", async () => {
    using dir = tempDir("reporter-ndjson-no-outfile", { "a.test.ts": fixture });
    const result = await run(String(dir), ["--reporter=ndjson"]);
    expect(result.stderr).toContain(
      "--reporter=ndjson requires --reporter-outfile [file] to specify where to write the events",
    );
    expect(result.exitCode).not.toBe(0);
  });

  test.concurrent("can't share --reporter-outfile with --reporter=junit", async () => {
    using dir = tempDir("reporter-ndjson-junit", { "a.test.ts": fixture });
    const result = await run(String(dir), ["--reporter=junit", "--reporter=ndjson", "--reporter-outfile=out.txt"]);
    expect(result.stderr).toContain("--reporter=junit and --reporter=ndjson can't both write to --reporter-outfile");
    expect(result.exitCode).not.toBe(0);
  });

  test.concurrent("is not supported with --parallel", async () => {
    using dir = tempDir("reporter-ndjson-parallel", { "a.test.ts": fixture });
    const result = await run(String(dir), ["--parallel=2", "--reporter=ndjson", "--reporter-outfile=events.ndjson"]);
    expect(result.stderr).toContain("--parallel does not support --reporter=ndjson or reporter modules yet");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("can be set in bunfig.toml, next to --reporter=junit", async () => {
    using dir = tempDir("reporter-ndjson-bunfig", {
      "a.test.ts": `import { test } from "bun:test"; test("one", () => {});`,
      "bunfig.toml": `[test.reporter]\nndjson = "events.ndjson"\njunit = "junit.xml"\n`,
    });
    const result = await run(String(dir), []);
    const events = await readEvents(String(dir));
    expect(events.map(event => event.type)).toEqual([
      "runStart",
      "fileStart",
      "fileCollected",
      "testStart",
      "testEnd",
      "fileEnd",
      "runEnd",
    ]);
    expect(await Bun.file(join(String(dir), "junit.xml")).text()).toContain('<testcase name="one"');
    expect(result.exitCode).toBe(0);
  });
});

describe("--reporter=<module>", () => {
  const recorder = `
    const events = [];
    export default class {
      onRunStart(event) { events.push(event.type); }
      onFileCollected(event) { events.push(event.type + " " + event.tests.length); }
      onTestEnd(event) { events.push(event.type + " " + event.fullName + " " + event.status); }
      async onRunEnd(event) {
        events.push(event.type + " " + event.pass + " " + event.fail);
        await Bun.sleep(10);
        await Bun.write("events.json", JSON.stringify(events));
      }
    }
  `;

  test.concurrent("calls the hook of each event and waits for the promise of onRunEnd", async () => {
    using dir = tempDir("reporter-module", { "a.test.ts": fixture, "reporter.ts": recorder });
    const result = await run(String(dir), ["--reporter=./reporter.ts"]);
    expect(await Bun.file(join(String(dir), "events.json")).json()).toEqual([
      "runStart",
      "fileCollected 7",
      "testEnd math > adds pass",
      "testEnd math > objects fail",
      "testEnd math > nested > skipped skip",
      "testEnd math > nested > later todo",
      "testEnd flaky pass",
      "runEnd 2 1",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("can be an object, and is loaded from bunfig.toml", async () => {
    using dir = tempDir("reporter-module-bunfig", {
      "a.test.ts": `import { test } from "bun:test"; test("one", () => {});`,
      "reporter.js": `
        const names = [];
        module.exports = {
          onTestEnd(event) { names.push(event.name); },
          onRunEnd() { require("node:fs").writeFileSync("names.json", JSON.stringify(names)); },
        };
      `,
      "bunfig.toml": `[test.reporter]\nmodules = ["./reporter.js"]\n`,
    });
    const result = await run(String(dir), []);
    expect(await Bun.file(join(String(dir), "names.json")).json()).toEqual(["one"]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("keeps its state across files under --isolate", async () => {
    using dir = tempDir("reporter-module-isolate", {
      "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
      "b.test.ts": `import { test } from "bun:test"; test("b", () => {});`,
      "reporter.ts": recorder,
    });
    const result = await run(String(dir), ["--isolate", "--reporter=./reporter.ts", "./a.test.ts", "./b.test.ts"]);
    expect(await Bun.file(join(String(dir), "events.json")).json()).toEqual([
      "runStart",
      "fileCollected 1",
      "testEnd a pass",
      "fileCollected 1",
      "testEnd b pass",
      "runEnd 2 0",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("fails the run when a hook throws, and gets no more events", async () => {
    using dir = tempDir("reporter-module-throws", {
      "a.test.ts": `import { test } from "bun:test"; test("a", () => {}); test("b", () => {});`,
      "reporter.ts": `
        let calls = 0;
        export default {
          onTestEnd() { calls++; throw new Error("reporter broke"); },
          onRunEnd() { throw new Error("not reached"); },
        };
      `,
    });
    const result = await run(String(dir), ["--reporter=./reporter.ts"]);
    expect(result.stderr.split("reporter broke").length - 1).toBe(1);
    expect(result.stderr).toContain(
      'note: a --reporter module failed while handling a "testEnd" event, so it gets no more events',
    );
    expect(result.stderr).not.toContain("not reached");
    expect(result.stderr).toContain(" 2 pass");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("fails the run when a promise of a hook rejects", async () => {
    using dir = tempDir("reporter-module-rejects", {
      "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
      "reporter.ts": `export default { async onRunEnd() { throw new Error("upload failed"); } };`,
    });
    const result = await run(String(dir), ["--reporter=./reporter.ts"]);
    expect(result.stderr).toContain("upload failed");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("stops before any test when the module can't be loaded", async () => {
    using dir = tempDir("reporter-module-missing", {
      "a.test.ts": `import { test } from "bun:test"; test("a", () => { console.error("RAN"); });`,
    });
    const result = await run(String(dir), ["--reporter=./missing.ts"]);
    expect(result.stderr).toContain("Cannot find module './missing.ts'");
    expect(result.stderr).toContain(
      `note: a --reporter that isn't "junit", "ndjson" or "dots" is a module, loaded from`,
    );
    expect(result.stderr).not.toContain("RAN");
    expect(result.exitCode).toBe(1);
  });

  test.concurrent("rejects a module that exports no reporter", async () => {
    using dir = tempDir("reporter-module-not-object", {
      "a.test.ts": `import { test } from "bun:test"; test("a", () => {});`,
      "reporter.ts": `export default 42;`,
    });
    const result = await run(String(dir), ["--reporter=./reporter.ts"]);
    expect(result.stderr).toContain(
      'The reporter module "./reporter.ts" must export a reporter object or class as its default export, got number',
    );
    expect(result.exitCode).toBe(1);
  });
});

test.concurrent("a failed matcher's error has expected and actual, which it doesn't print", async () => {
  using dir = tempDir("matcher-compared-values", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("values", () => {
        let error;
        try { expect({ a: 1 }).toEqual({ a: 2 }); } catch (e) { error = e; }
        expect(error.expected).toEqual({ a: 2 });
        expect(error.actual).toEqual({ a: 1 });
        expect(Object.keys(error)).not.toContain("expected");
        let negated;
        try { expect(1).not.toBe(1); } catch (e) { negated = e; }
        expect(Object.getOwnPropertyNames(negated)).not.toContain("expected");
      });
      test("prints", () => {
        expect(1).toBe(2);
      });
    `,
  });
  const result = await run(String(dir), []);
  expect(result.stderr).toContain("(pass) values");
  expect(result.stderr).not.toContain("expected:");
  expect(result.stderr).not.toContain("actual:");
  expect(result.exitCode).toBe(1);
});
