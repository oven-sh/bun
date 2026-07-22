import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isWindows, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it.todoIf(isBroken && isWindows)(
    `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
    async () => {
      const cwd = join(tmpdirSync(), dir);
      const path = join(cwd, "watchee.js");

      const updateFile = async (i: number) => {
        await Bun.write(path, `console.log(${i}, __dirname);`);
      };

      let i = 0;
      await updateFile(i);
      await Bun.sleep(1000);
      watchee = spawn({
        cwd,
        cmd: [bunExe(), "--watch", "watchee.js"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      for await (const line of watchee.stdout) {
        if (i == 10) break;
        var str = new TextDecoder().decode(line);
        expect(str).toContain(`${i} ${cwd}`);
        i++;
        await updateFile(i);
      }
      rmSync(path);
    },
    10000,
  );
}

afterEach(() => {
  watchee?.kill();
});

it.skipIf(isWindows)("process.exit() in a watch kill-signal handler never returns to JS", async () => {
  const cwd = tmpdirSync();
  const path = join(cwd, "exiter.js");
  await Bun.write(
    path,
    `process.on("SIGTERM", () => {
  process.exit(0);
  require("fs").writeFileSync("should-not-write.txt", "hello");
});
process.on("SIGTERM", () => {
  require("fs").writeFileSync("second-listener-ran.txt", "hello");
});
console.log("started");
setInterval(() => {}, 1000);
`,
  );
  watchee = spawn({
    cwd,
    cmd: [bunExe(), "--watch", "exiter.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  let starts = 0;
  const reader = (async () => {
    for await (const chunk of watchee.stdout) {
      const str = new TextDecoder().decode(chunk);
      for (const line of str.split("\n")) {
        if (line.includes("started") && ++starts === 2) return;
      }
      if (starts === 1) {
        // First boot seen: touch the file to trigger the kill-signal reload.
        await Bun.write(path, (await Bun.file(path).text()) + "\n// touched");
      }
    }
  })();
  // Trigger in case the first "started" arrived before the reader attached.
  await Bun.sleep(500);
  if (starts === 0) await Bun.write(path, (await Bun.file(path).text()) + "\n// warm");
  await reader;
  expect(await Bun.file(join(cwd, "should-not-write.txt")).exists()).toBe(false);
  expect(await Bun.file(join(cwd, "second-listener-ran.txt")).exists()).toBe(false);
});
