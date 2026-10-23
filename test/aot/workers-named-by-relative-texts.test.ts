// `new Worker("./main.ts")`: a worker is named by a text that is relative to the folder of the program: its own file, another entry point, with the extension as written, with another one, without one,
// by a detour through a folder, and a file that is not there. An executable answers as plain Bun does in the folder of the sources, wherever the executable itself is run.
import { afterAll, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { built, spawned, withoutDebugInformation } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

describe("compile/aot/workers named by relative texts", () => {
  const root = String(tempDir("aot-workers-named-by-relative-texts", {}));
  const sources = join(root, "sources");
  const elsewhere = join(root, "elsewhere");
  const executable = join(elsewhere, "program");
  let plain = "";
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    mkdirSync(join(sources, "lib"), { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(
      join(sources, "main.ts"),
      `if (Bun.isMainThread) {
  const start = (name: string) =>
    new Promise<string>(resolve => {
      let worker: Worker;
      try {
        worker = new Worker(name);
      } catch (error) {
        return resolve(name + " THROWS " + (error as Error).name);
      }
      worker.onmessage = event => {
        resolve(name + " " + event.data);
        worker.terminate();
      };
      worker.addEventListener("close", (event: any) => resolve(name + " closed " + event.code));
      worker.addEventListener("error", (event: any) => {
        event.preventDefault?.();
      });
    });
  for (const name of ["./main.ts", "./main", "./main.js", "./lib/../main.ts", "./lib/other.ts", "./lib/other", "./lib/other.js", "./nope.ts"]) console.log(await start(name));
} else postMessage("started");
`,
    );
    writeFileSync(join(sources, "lib", "other.ts"), `postMessage("other");\n`);
    const reference = await spawned([bunExe(), "run", "main.ts"], sources, bunEnv);
    expect({ exitCode: reference.exitCode, signal: reference.signal }).toEqual({ exitCode: 0, signal: null });
    plain = reference.stdout;
    built(
      await spawned(
        [
          bunExe(),
          ...compileCommand,
          ...withoutDebugInformation(),
          "./main.ts",
          "./lib/other.ts",
          "--outfile",
          executable,
        ],
        sources,
        bunEnv,
      ),
    );
  }, 300_000);

  test.each([
    ["in the folder of the sources", sources],
    ["elsewhere", elsewhere],
  ])("%s", async (_, folder) => {
    const run = await spawned([executable], folder, bunEnv);
    expect({ stdout: run.stdout, exitCode: run.exitCode, signal: run.signal }).toEqual({
      stdout: plain,
      exitCode: 0,
      signal: null,
    });
  });
});
