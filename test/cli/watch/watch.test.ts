import { it, expect, afterEach } from "bun:test";
import type { Subprocess } from "bun";
import { spawn } from "bun";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { bunExe, bunEnv, tmpdirSync } from "harness";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it(`should watch files ${dir === "dir" ? "" : "(non-ascii path)"}`, async () => {
    const cwd = join(tmpdirSync(), dir);
    const path = join(cwd, "watchee.js");

    const updateFile = async (i: number) => {
      await Bun.write(path, `console.log(${i}, __dirname);`);
    };

    let i = 0;
    await updateFile(i);
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
  });
}

afterEach(() => {
  watchee?.kill();
});
