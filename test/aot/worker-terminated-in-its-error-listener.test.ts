import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "start.ts": `import { Worker as NodeWorker } from "node:worker_threads";

const ways: Record<string, () => void> = {
  "leaves a rejection": () => {
    Promise.reject(new Error("nobody handles this"));
  },
  "throws": () => {
    throw new Error("nobody catches this");
  },
};

if (Bun.isMainThread) {
  for (const way of Object.keys(ways)) {
    const env = { ...process.env, WAY: way };
    const webWorker = new Worker(new URL(import.meta.url), { env } as any);
    webWorker.onerror = () => webWorker.terminate();
    const closed = Promise.withResolvers<number>();
    webWorker.addEventListener("close", event => closed.resolve((event as any).code));
    console.log("web Worker", way + ":", await closed.promise);

    const nodeWorker = new NodeWorker(new URL(import.meta.url), { env });
    nodeWorker.on("error", () => nodeWorker.terminate());
    const exited = Promise.withResolvers<number>();
    nodeWorker.on("exit", exited.resolve);
    console.log("node Worker", way + ":", await exited.promise);
  }
} else {
  // The parent hears of the error while this listener runs.
  process.on("exit", () => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300));
  ways[process.env.WAY!]();
}
`,
};

const expected = {
  stdout: `web Worker leaves a rejection: 1
node Worker leaves a rejection: 1
web Worker throws: 1
node Worker throws: 1
`,
  exitCode: 0,
};

test("a Worker that fails exits with 1 when its error listener calls terminate()", async () => {
  using dir = tempDir("aot-worker-terminated-in-its-error-listener", files);
  const folder = String(dir);
  const outcome = async (cmd: string[]) => {
    const { stdout, exitCode } = await run(cmd, folder, bunEnv);
    return { stdout, exitCode };
  };
  expect(await outcome([bunExe(), "run", "./start.ts"])).toEqual(expected);
  for (const flags of [[], ["--aot"]]) {
    const executable = join(folder, "program" + flags.join("") + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", ...flags, "./start.ts", "--outfile", executable], folder);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await outcome([executable])).toEqual(expected);
  }
}, 120_000);
