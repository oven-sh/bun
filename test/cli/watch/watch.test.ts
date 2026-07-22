import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
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

async function nextMatching(iter: AsyncGenerator<string>, needle: string): Promise<string> {
  while (true) {
    const { value, done } = await iter.next();
    if (done) throw new Error(`stream ended before a line containing ${JSON.stringify(needle)} was seen`);
    if (value.includes(needle)) return value;
  }
}

for (const { label, arg, file } of [
  { label: "explicit path", arg: "entry.ts", file: "entry.ts" },
  { label: "extensionless path", arg: "./entry", file: "entry.ts" },
  { label: "dotted extensionless path", arg: "./vite.config", file: "vite.config.ts" },
  { label: "directory path", arg: ".", file: "index.ts" },
]) {
  it(`should survive the entrypoint being transiently deleted (${label})`, async () => {
    using dir = tempDir("watch-entry-delete", {
      [file]: `console.log("BOOT 1"); setInterval(() => {}, 1000);`,
    });
    const entry = join(String(dir), file);

    watchee = spawn({
      cmd: [bunExe(), "--no-clear-screen", "--watch", arg],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const stdout = forEachLine(watchee.stdout);
    const stderr = forEachLine(watchee.stderr);

    expect(await nextMatching(stdout, "BOOT")).toContain("BOOT 1");

    // Entrypoint goes away; the watcher restarts into a process that cannot
    // resolve it. Previously this killed the whole watch session with exit 1.
    unlinkSync(entry);
    expect(await nextMatching(stderr, "Module not found")).toContain(arg);
    expect(watchee.exitCode).toBeNull();

    writeFileSync(entry, `console.log("BOOT 2"); setInterval(() => {}, 1000);`);
    expect(await nextMatching(stdout, "BOOT")).toContain("BOOT 2");
    expect(watchee.exitCode).toBeNull();

    watchee.kill();
    await watchee.exited;
  });
}

it("should start watching when the entrypoint does not yet exist", async () => {
  using dir = tempDir("watch-entry-missing", {
    "placeholder.txt": "",
  });
  const entry = join(String(dir), "entry.ts");

  watchee = spawn({
    cmd: [bunExe(), "--no-clear-screen", "--watch", "entry.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const stdout = forEachLine(watchee.stdout);
  const stderr = forEachLine(watchee.stderr);

  expect(await nextMatching(stderr, "Module not found")).toContain("entry.ts");
  expect(watchee.exitCode).toBeNull();

  writeFileSync(entry, `console.log("BOOT ok"); setInterval(() => {}, 1000);`);
  expect(await nextMatching(stdout, "BOOT")).toContain("BOOT ok");
  expect(watchee.exitCode).toBeNull();

  watchee.kill();
  await watchee.exited;
});
