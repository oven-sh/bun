import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const timeout = 600_000;

const files = {
  "main.js": `
    import path from "./worker.js" with { type: "file" };
    const worker = new Worker(path);
    worker.onmessage = event => {
      console.log(event.data);
      worker.terminate();
    };
    worker.onerror = event => console.log("error: " + event.message.split("\\n")[0]);
    worker.postMessage(20);
  `,
  "worker.js": `
    import { double } from "./shared.js";
    self.onmessage = event => postMessage("worker " + import.meta.path.split(/[\\\\/]/).pop().replace(/-[a-z0-9]+\\.js$/, "-<hash>.js") + " answers " + double(event.data + 1));
  `,
  "shared.js": `export const double = value => value * 2;`,
};

async function compileAndRun(folder: string, flags: string[], entryPoints: string[]) {
  const executable = join(folder, "program" + flags.join("") + entryPoints.length + (isWindows ? ".exe" : ""));
  const build = await spawned(
    [bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", executable],
    folder,
    bunEnv,
  );
  built(build);
  return spawned([executable], folder, bunEnv);
}

describe.concurrent("a Worker started by the path of a file that is embedded with the file loader", () => {
  test(
    "runs the compiled program where the file is an entry point too",
    () =>
      slot(async () => {
        using dir = tempDir("aot-worker-from-embedded-file", files);
        const { stdout, exitCode } = await compileAndRun(String(dir), ["--aot"], ["./main.js", "./worker.js"]);
        expect({ stdout, exitCode }).toEqual({ stdout: "worker worker.js answers 42\n", exitCode: 0 });
      }),
    timeout,
  );

  test("runs under bun run", async () => {
    using dir = tempDir("aot-worker-from-embedded-file", files);
    const { stdout, exitCode } = await spawned([bunExe(), "run", "main.js"], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: "worker worker.js answers 42\n", exitCode: 0 });
  });
});
