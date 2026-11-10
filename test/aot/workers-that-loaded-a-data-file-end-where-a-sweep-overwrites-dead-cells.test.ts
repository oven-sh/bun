import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.ts": `let sum = 0;
for (let i = 0; i < 20; i++) {
  sum += await new Promise<number>((done, fail) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    let answer = 0;
    worker.onmessage = event => {
      answer = event.data;
      worker.terminate();
    };
    worker.onerror = event => fail(new Error(String(event.message)));
    worker.addEventListener("close", () => done(answer));
  });
}
console.log("ended", sum);
export {};
`,
  "worker.ts": `import config from "./config.json";
declare function postMessage(value: unknown): void;
const later = (await import("./config.json")).default;
postMessage(config.items.length + later.items.length);
export {};
`,
  "config.json": `{ "name": "made-up", "items": [1, 2, 3] }\n`,
};

test("Workers that loaded a data file end where a sweep overwrites dead cells", async () => {
  using dir = tempDir("aot-workers-end", files);
  const executable = join(String(dir), "main");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "./worker.ts", "--outfile", executable],
    String(dir),
  );
  expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  for (const command of [[bunExe(), "main.ts"], [executable]]) {
    const { stdout, exitCode } = await run(command, String(dir), { ...bunEnv, BUN_JSC_useZombieMode: "1" });
    expect({ stdout, exitCode }).toEqual({ stdout: "ended 120\n", exitCode: 0 });
  }
}, 240_000);
