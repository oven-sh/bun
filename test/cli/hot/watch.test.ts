import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir } from "harness";
import { closeSync, openSync, readSync, truncateSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

describe.todoIf(isBroken && isWindows)("--watch works", async () => {
  for (const watchedFile of ["entry.js", "tmp.js"]) {
    test(`with ${watchedFile}`, async () => {
      await using tmpdir_ = tempDir("watch-fixture", {
        "tmp.js": "console.log('hello #1')",
        "entry.js": "import './tmp.js'",
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
      });
      await Bun.sleep(1000);
      const tmpfile = join(tmpdir_, "tmp.js");
      const process = spawn({
        cmd: [bunExe(), "--watch", join(tmpdir_, watchedFile)],
        cwd: tmpdir_,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const { stdout } = process;

      const iter = forEachLine(stdout);
      let { value: line, done } = await iter.next();
      expect(done).toBe(false);
      expect(line).toBe("hello #1");

      await writeFile(tmpfile, "console.log('hello #2')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #2");

      await writeFile(tmpfile, "console.log('hello #3')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #3");

      await writeFile(tmpfile, "console.log('hello #4')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #4");

      await writeFile(tmpfile, "console.log('hello #5')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #5");

      process.kill("SIGKILL");
      await process.exited;
    });
  }

  // A run moves the position of a regular-file stdin, and the next run inherits the same
  // descriptor. Each run must start where the first one did.
  async function linesOfThreeRuns(
    script: (run: number) => string,
    { zeroBytesAfterInput = 0, env = {} }: { zeroBytesAfterInput?: number; env?: Record<string, string> } = {},
  ) {
    await using tmpdir_ = tempDir("watch-stdin-fixture", {
      "input.txt": "SECRET-HEADER\nbody\n",
      "stdin.js": script(1),
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
    });
    const input = join(tmpdir_, "input.txt");
    truncateSync(input, "SECRET-HEADER\nbody\n".length + zeroBytesAfterInput);
    const fd = openSync(input, "r");
    try {
      // The parent took the first line, so every run starts after it.
      readSync(fd, Buffer.alloc("SECRET-HEADER\n".length));
      await using proc = spawn({
        cmd: [bunExe(), "--watch", join(tmpdir_, "stdin.js")],
        cwd: tmpdir_,
        env: { ...bunEnv, ...env },
        stdio: [fd, "pipe", "inherit"],
      });
      const iter = forEachLine(proc.stdout);
      const lines: (string | undefined)[] = [];
      for (let run = 1; run <= 3; run++) {
        // The watcher can restart a run for an earlier write. Skip a line that such a restart repeats.
        let line: string | undefined;
        do {
          line = (await iter.next()).value;
        } while (line !== undefined && !line.startsWith(`run ${run}:`));
        lines.push(line);
        if (run < 3) await writeFile(join(tmpdir_, "stdin.js"), script(run + 1));
      }
      proc.kill("SIGKILL");
      await proc.exited;
      return lines;
    } finally {
      closeSync(fd);
    }
  }

  for (const read of ["await Bun.stdin.text()", "await new Response(Bun.stdin.stream()).text()"]) {
    test(`each run reads a regular-file stdin again with ${read}`, async () => {
      const lines = await linesOfThreeRuns(run => `console.log("run ${run}: " + JSON.stringify(${read}));`);
      expect(lines).toEqual([`run 1: "body\\n"`, `run 2: "body\\n"`, `run 3: "body\\n"`]);
    });
  }

  test("a run that still reads stdin when the next run starts does not move the next run", async () => {
    // Each run prints the next line. Then it reads one byte at a time until the watcher ends it.
    const script = (run: number) => `
      const fs = require("node:fs");
      const line = Buffer.alloc(5);
      fs.readSync(0, line);
      fs.writeSync(1, "run ${run}: " + JSON.stringify(line.toString()) + "\\n");
      for (const byte = Buffer.alloc(1); fs.readSync(0, byte) === 1; );
    `;
    const lines = await linesOfThreeRuns(script, { zeroBytesAfterInput: 64 * 1024 * 1024 });
    expect(lines).toEqual([`run 1: "body\\n"`, `run 2: "body\\n"`, `run 3: "body\\n"`]);
  });

  test("a stdin position that another process recorded is not used", async () => {
    const script = (run: number) => `console.log("run ${run}: " + JSON.stringify(await Bun.stdin.text()));`;
    // A child process of a watched script inherits the record of its parent in the environment.
    const lines = await linesOfThreeRuns(script, { env: { BUN_INTERNAL_WATCH_STDIN: "0:0" } });
    expect(lines).toEqual([`run 1: "body\\n"`, `run 2: "body\\n"`, `run 3: "body\\n"`]);
  });
});
