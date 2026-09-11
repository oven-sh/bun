import { spawnSync } from "bun";
import { expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

it("should not log .env when quiet", async () => {
  using dir = tempDir("log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": `logLevel = "error"`,
    "index.ts": "export default console.log('Here');",
  });
  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
  });

  expect(stderr!.toString()).toBe("");
});

it("should log .env by default", async () => {
  using dir = tempDir("log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": ``,
    "index.ts": "export default console.log('Here');",
  });

  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
  });

  expect(stderr?.toString().includes(".env")).toBe(false);
});

// A Worker's VM gets its own Log. Its level has to be the one the process was
// configured with, the same as the main thread's, in every build type.
const logLevels: [name: string, bunfig: string, debug: boolean][] = [
  ["the default log level", "", false],
  ['logLevel = "error"', 'logLevel = "error"', false],
  ['logLevel = "debug"', 'logLevel = "debug"', true],
];

// stderr is split at this marker: everything the main thread logs while it
// starts up comes before it, everything the Worker logs comes after it.
const marker = "--- main thread done ---\n";

function splitAtMarker(stderr: string): [mainThread: string, worker: string] {
  const index = stderr.indexOf(marker);
  if (index === -1) throw new Error(`the main thread never printed the marker. stderr:\n${stderr}`);
  return [stderr.slice(0, index), stderr.slice(index + marker.length)];
}

function countOccurrences(haystack: string, needle: string | RegExp): number {
  return haystack.split(needle).length - 1;
}

test.concurrent.each(logLevels)(
  "a Worker prints the .env files it loaded under %s exactly when the main thread does",
  async (_, bunfig, debug) => {
    using dir = tempDir("log-test-worker-env", {
      ".env": "FOO=bar",
      "bunfig.toml": bunfig,
      "index.ts": `
        console.error(${JSON.stringify(marker.trimEnd())});
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = ({ data }) => {
          console.log(data);
          worker.terminate();
        };
        worker.onerror = event => {
          console.log("worker error: " + event.message);
          worker.terminate();
        };
      `,
      "worker.ts": `postMessage("worker sees FOO=" + process.env.FOO);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const [mainThreadStderr, workerStderr] = splitAtMarker(stderr);
    expect({
      stdout,
      mainThreadEnvLines: countOccurrences(mainThreadStderr, /"\.env"/),
      workerEnvLines: countOccurrences(workerStderr, /"\.env"/),
      exitCode,
    }).toEqual({
      stdout: "worker sees FOO=bar\n",
      mainThreadEnvLines: debug ? 1 : 0,
      workerEnvLines: debug ? 1 : 0,
      exitCode: 0,
    });
  },
);

test.concurrent.each(logLevels)(
  "fetch() inside a Worker prints the verbose request under %s exactly when the main thread does",
  async (_, bunfig, debug) => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });
    const url = server.url.href;

    using dir = tempDir("log-test-worker-fetch", {
      "bunfig.toml": bunfig,
      "index.ts": `
        const response = await fetch(${JSON.stringify(url)});
        console.log("main thread got " + (await response.text()));
        console.error(${JSON.stringify(marker.trimEnd())});
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        worker.onmessage = ({ data }) => {
          console.log(data);
          worker.terminate();
        };
        worker.onerror = event => {
          console.log("worker error: " + event.message);
          worker.terminate();
        };
      `,
      "worker.ts": `
        const response = await fetch(${JSON.stringify(url)});
        postMessage("worker got " + (await response.text()));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The verbose dump is written by the HTTP thread before the response is
    // handed to JS, so each thread's request line lands on its side of the marker.
    const requestLine = `HTTP/1.1 GET ${url}`;
    const [mainThreadStderr, workerStderr] = splitAtMarker(stderr);
    expect({
      stdout,
      mainThreadRequestLines: countOccurrences(mainThreadStderr, requestLine),
      workerRequestLines: countOccurrences(workerStderr, requestLine),
      exitCode,
    }).toEqual({
      stdout: "main thread got ok\nworker got ok\n",
      mainThreadRequestLines: debug ? 1 : 0,
      workerRequestLines: debug ? 1 : 0,
      exitCode: 0,
    });
  },
);
