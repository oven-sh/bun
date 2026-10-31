import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { endChildren, spawn } from "../children";

// Nothing is queued and nothing ref'd is left on the event loop while a test file loads: its top-level
// await can never settle. The file fails with the place of the await, and the run goes on.
// https://github.com/oven-sh/bun/issues/19049

const passing = `import { test } from "bun:test";\ntest("passes", () => {});\n`;

// A build without the fix polls for ever in these children. Their tests time out, and this ends them with the file.
afterAll(endChildren);

async function run(files: Record<string, string>, args: string[]) {
  using dir = tempDir("bun-test-unsettled-tla", files);
  await using proc = spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr.replace(/file:\/\/\S*\//g, "file://<dir>/").split(/\r?\n/);
  return {
    stdout: stdout.replace(/^bun test v.*\n/, ""),
    located: lines.filter(line => line.includes("Detected unsettled top-level await")),
    summary: lines.filter(line => /^ *\d+ (pass|fail|errors?)$|^Bailed out/.test(line)).map(line => line.trim()),
    exitCode,
    signalCode: proc.signalCode,
  };
}

for (const isolate of [[], ["--isolate"]]) {
  test.concurrent(
    `fails the file once its timers are done, and the next file runs (${isolate[0] ?? "one global"})`,
    async () => {
      const a = `console.log("a loads");\nawait new Promise(() => setTimeout(() => console.log("timer"), 20));\n${passing}`;
      expect(await run({ "a.test.ts": a, "b.test.ts": passing }, [...isolate, "./a.test.ts", "./b.test.ts"])).toEqual({
        stdout: "a loads\ntimer\n",
        located: ["error: Detected unsettled top-level await at file://<dir>/a.test.ts:2"],
        summary: ["1 pass", "1 fail", "1 error"],
        exitCode: 1,
        signalCode: null,
      });
    },
  );
}

// A worker of --parallel loads the file, and the coordinator prints what the worker reports.
// On Windows the pipe between a worker and the coordinator keeps the loop of the worker alive. The wait of the worker
// never sees an idle loop there, and the run hangs as it did before.
test.concurrent.todoIf(isWindows)("fails the file in a worker of --parallel, and the next file runs", async () => {
  const a = `await new Promise(() => {});\n${passing}`;
  expect(await run({ "a.test.ts": a, "b.test.ts": passing }, ["--parallel=2", "./a.test.ts", "./b.test.ts"])).toEqual({
    stdout: "",
    located: ["error: Detected unsettled top-level await at file://<dir>/a.test.ts:1"],
    summary: ["1 pass", "1 fail", "1 error"],
    exitCode: 1,
    signalCode: null,
  });
});

// Unref'd work can settle the await of a file after the file failed. Here the file waits for a request to its server,
// which is unref'd, and a later file sends that request. The file is over by then: the rest of it does not run under
// the later file. Under --isolate the server is closed with the realm of its file, and the request fails.
const waitsForARequest = `import { writeFileSync } from "node:fs";
const { promise, resolve } = Promise.withResolvers<void>();
const server = Bun.serve({
  port: 0,
  fetch() {
    resolve();
    return new Response("settled");
  },
});
server.unref();
writeFileSync("url", server.url.href);
await promise;
`;
const sendsTheRequest = (then = "") => `import { test } from "bun:test";
import { readFileSync } from "node:fs";
test("sends the request", async () => {
  await fetch(readFileSync("url", "utf8")).then(
    response => response.text(),
    () => {},
  );${then}
});
`;
const lineOfAwait = (source: string) => source.split("\n").indexOf("await promise;") + 1;

// `--aot` runs the files as compiled code. A compiled module is suspended in a frame of machine code, and the rejection
// of its record does not reach that frame: with one global the rest of the file still runs. It has no bytecode that
// says where it is suspended either, so the error names the file without a line.
for (const args of [[], ["--isolate"], ["--aot"]]) {
  const isCompiled = args[0] === "--aot";
  const declare = isCompiled ? test.todo : test.concurrent;
  declare(`a file that failed does not go on under a later file (${args[0] ?? "one global"})`, async () => {
    const a = `import { beforeEach, test } from "bun:test";
${waitsForARequest}console.log("a goes on");
beforeEach(() => console.log("a hook of a"));
test("late", () => {});
`;
    expect(
      await run({ "a.test.ts": a, "b.test.ts": sendsTheRequest() }, [...args, "./a.test.ts", "./b.test.ts"]),
    ).toEqual({
      stdout: "",
      located: [
        `error: Detected unsettled top-level await at file://<dir>/a.test.ts${isCompiled ? "" : `:${lineOfAwait(a)}`}`,
      ],
      summary: ["1 pass", "1 fail", "1 error"],
      exitCode: 1,
      signalCode: null,
    });
  });
}

// The same for a module that the file waits for behind an import(): it is part of the file that is over.
test.concurrent("a module behind the import() of a file that failed does not go on under a later file", async () => {
  const a = `import { test } from "bun:test";
await import("./helper.ts");
console.log("a goes on");
test("late", () => {});
`;
  const helper = `import { beforeEach } from "bun:test";
${waitsForARequest}console.log("helper goes on");
beforeEach(() => console.log("a hook of helper"));
`;
  expect(
    await run({ "a.test.ts": a, "helper.ts": helper, "b.test.ts": sendsTheRequest() }, ["./a.test.ts", "./b.test.ts"]),
  ).toEqual({
    stdout: "",
    located: ["error: Detected unsettled top-level await at file://<dir>/a.test.ts:2"],
    summary: ["1 pass", "1 fail", "1 error"],
    exitCode: 1,
    signalCode: null,
  });
});

// The module that was given up on has failed for good. A later file settles its await and then imports it: the
// import fails with the same error.
test.concurrent("a later file that imports the module that was given up on fails too", async () => {
  const setup = `${waitsForARequest}console.log("setup goes on");\n`;
  const a = `import "./setup.ts";\n${passing}`;
  const b = sendsTheRequest(`\n  await import("./setup.ts");`);
  const error = `error: Detected unsettled top-level await at file://<dir>/setup.ts:${lineOfAwait(setup)}`;
  expect(await run({ "a.test.ts": a, "b.test.ts": b, "setup.ts": setup }, ["./a.test.ts", "./b.test.ts"])).toEqual({
    stdout: "",
    located: [error, error],
    summary: ["0 pass", "2 fail", "1 error"],
    exitCode: 1,
    signalCode: null,
  });
});

test.concurrent("names the module that is suspended", async () => {
  expect(
    await run(
      {
        "a.test.ts": `import "./setup.ts";\n${passing}`,
        "setup.ts": `const ready: Promise<void> = new Promise(() => {});\n\nawait ready;\n`,
      },
      ["./a.test.ts"],
    ),
  ).toEqual({
    stdout: "",
    located: ["error: Detected unsettled top-level await at file://<dir>/setup.ts:3"],
    summary: ["0 pass", "1 fail", "1 error"],
    exitCode: 1,
    signalCode: null,
  });
});

test.concurrent("counts for --bail", async () => {
  expect(
    await run({ "a.test.ts": `await new Promise(() => {});\n${passing}`, "b.test.ts": passing }, [
      "--bail",
      "./a.test.ts",
      "./b.test.ts",
    ]),
  ).toEqual({
    stdout: "",
    located: ["error: Detected unsettled top-level await at file://<dir>/a.test.ts:1"],
    summary: ["Bailed out after 1 failure"],
    exitCode: 1,
    signalCode: null,
  });
});

// A preload that cannot finish fails like a preload that throws: each file reports its error, and no file runs.
test.concurrent("a --preload that cannot finish fails every file", async () => {
  expect(
    await run({ "preload.ts": `await new Promise(() => {});\n`, "a.test.ts": passing, "b.test.ts": passing }, [
      "--preload",
      "./preload.ts",
      "./a.test.ts",
      "./b.test.ts",
    ]),
  ).toEqual({
    stdout: "",
    located: [
      "error: Detected unsettled top-level await at file://<dir>/preload.ts:1",
      "error: Detected unsettled top-level await at file://<dir>/preload.ts:1",
    ],
    summary: ["0 pass", "2 fail", "2 errors"],
    exitCode: 1,
    signalCode: null,
  });
});

// The two files of the report.
test.concurrent("a mocked module whose timer does nothing", async () => {
  expect(
    await run(
      {
        "preload.ts": `import { mock } from "bun:test";

mock.module("node:http2", () => {
	return {
		default: {
			connect: mock(),
		},
	};
});
`,
        "bad.test.ts": `import { mock } from "bun:test";
import http2 from "node:http2";

mock.module("node:http2", () => ({
	default: {
		connect: mock().mockReturnValue({
			request: mock(() => setTimeout(() => {}, 50)),
		}),
	},
}));

await new Promise(() => http2.connect("foo").request());
`,
      },
      ["--preload", "./preload.ts", "./bad.test.ts"],
    ),
  ).toEqual({
    stdout: "",
    located: ["error: Detected unsettled top-level await at file://<dir>/bad.test.ts:12"],
    summary: ["0 pass", "1 fail", "1 error"],
    exitCode: 1,
    signalCode: null,
  });
});

// The count of unhandled errors outlives the file that raised them. It must not end the wait of a later file.
test.concurrent("a live await in a later file is waited for after an earlier file's unhandled error", async () => {
  expect(
    await run(
      {
        "a.test.ts": `Promise.reject(new Error("unhandled in a"));\n${passing}`,
        "b.test.ts": `await new Promise(resolve => setTimeout(resolve, 20));\n${passing}`,
      },
      ["./a.test.ts", "./b.test.ts"],
    ),
  ).toEqual({ stdout: "", located: [], summary: ["1 pass", "0 fail", "1 error"], exitCode: 1, signalCode: null });
});

// A matcher waits beneath a test, where the loop keeps turning and unref'd work settles promises: it does not give up.
test.concurrent("a matcher waits for a promise that only unref'd work settles", async () => {
  expect(
    await run(
      {
        "a.test.ts": `import { expect, test } from "bun:test";
test("resolves", async () => {
  await expect(new Promise(resolve => setTimeout(() => resolve(1), 20).unref())).resolves.toBe(1);
});
`,
      },
      ["./a.test.ts"],
    ),
  ).toEqual({ stdout: "", located: [], summary: ["1 pass", "0 fail"], exitCode: 0, signalCode: null });
});
