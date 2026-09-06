import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir } from "harness";
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
});

async function readUntil(lines: AsyncIterator<string>, predicate: (line: string) => boolean): Promise<string> {
  while (true) {
    const { value, done } = await lines.next();
    if (done) throw new Error("stream ended before the expected line");
    if (predicate(value)) return value;
  }
}

describe.todoIf(isBroken && isWindows)("--watch recovers from a missing import", () => {
  test("bun --watch reruns when the missing file is created", async () => {
    await using dir = tempDir("watch-missing-import", {
      "entry.js": `import { a } from "./a.js"; console.log("RUN", a);`,
    });
    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "entry.js"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = forEachLine(proc.stdout);
    const stderr = forEachLine(proc.stderr);

    await readUntil(stderr, line => line.includes("Cannot find module"));

    await writeFile(join(String(dir), "a.js"), "export const a = 10;");
    expect(await readUntil(stdout, line => line.startsWith("RUN"))).toBe("RUN 10");

    await writeFile(join(String(dir), "a.js"), "export const a = 20;");
    expect(await readUntil(stdout, line => line.startsWith("RUN"))).toBe("RUN 20");

    proc.kill("SIGKILL");
    await proc.exited;
  });

  test("bun build --watch keeps rebuilding and recovers", async () => {
    await using dir = tempDir("build-watch-missing-import", {
      "entry.js": `import { a } from "./a.js"; import { b } from "./b.js"; console.log(a + b);`,
      "b.js": "export const b = 2;",
    });
    await using proc = spawn({
      cmd: [bunExe(), "build", "entry.js", "--outdir", "out", "--watch", "--no-clear-screen"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = forEachLine(proc.stdout);
    const stderr = forEachLine(proc.stderr);
    const isResolveError = (line: string) => line.includes('Could not resolve: "./a.js"');

    await readUntil(stderr, isResolveError);

    // An edit to an import that did resolve rebuilds while a.js is missing.
    await writeFile(join(String(dir), "b.js"), "export const b = 30;");
    await readUntil(stderr, isResolveError);

    // Creating the missing file rebuilds with both edits.
    await writeFile(join(String(dir), "a.js"), "export const a = 10;");
    // The per-file row is printed after the file is written.
    await readUntil(stdout, line => line.includes("entry.js") && line.includes("(entry point)"));
    const bundle = await Bun.file(join(String(dir), "out", "entry.js")).text();
    expect(bundle).toContain("var a = 10");
    expect(bundle).toContain("var b = 30");

    proc.kill("SIGKILL");
    await proc.exited;
  });
});
