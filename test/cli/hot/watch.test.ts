import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { bunEnv, bunExe, forEachLine, tempDirWithFiles } from "harness";
import { join } from "node:path";

describe("--watch works", async () => {
  for (const watchedFile of ["tmp.js", "entry.js"]) {
    test(`with ${watchedFile}`, async () => {
      const tmpdir_ = tempDirWithFiles("watch-fixture", {
        "tmp.js": "console.log('hello #1')",
        "entry.js": "import './tmp.js'",
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
      });
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
});
