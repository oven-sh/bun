import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, LineReader, tempDir } from "harness";
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

describe.todoIf(isBroken && isWindows)("--watch recovers from a missing import", () => {
  test.concurrent.each([
    ["./a.js", "a.js"],
    // The resolver looks a name up without regard to ASCII case.
    ["./Dep.js", "dep.js"],
    ["./a", "a.ts"],
    ["./a.js", "a.ts"],
    ["<absolute>/abs.js", "abs.js"],
  ])("bun --watch reruns when the missing %s is created as %s", async (specifier, created) => {
    await using dir = tempDir("watch-missing-import", {});
    const from = specifier.replace("<absolute>", String(dir));
    await writeFile(join(String(dir), "entry.js"), `import { a } from ${JSON.stringify(from)}; console.log("RUN", a);`);
    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "entry.js"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new LineReader(proc.stdout);
    const stderr = new LineReader(proc.stderr);

    await stderr.until(line => line.includes("Cannot find module"));

    await writeFile(join(String(dir), created), "export const a = 10;");
    expect(await stdout.until(line => line.startsWith("RUN"))).toBe("RUN 10");

    await writeFile(join(String(dir), created), "export const a = 20;");
    expect(await stdout.until(line => line.startsWith("RUN"))).toBe("RUN 20");

    proc.kill("SIGKILL");
    await proc.exited;
  });

  test.concurrent("a directory import that resolves does not rerun on a sibling file", async () => {
    // `./lib` misses as a file before it resolves as `lib/index.js`. A file the
    // program writes next to it must not count as the missing file appearing.
    await using dir = tempDir("watch-dir-import", {
      "entry.js": `
        import { writeFileSync } from "node:fs";
        import { v } from "./lib";
        console.log("RUN", v);
        writeFileSync("lib.log", String(Date.now()));
      `,
      "lib/index.js": "export const v = 1;",
    });
    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "entry.js"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new LineReader(proc.stdout);

    expect(await stdout.until(line => line.startsWith("RUN"))).toBe("RUN 1");

    // A rerun from the lib.log write would land well inside this window. A
    // correct build prints nothing here, so the window cannot make it flake.
    expect(await stdout.within(2000)).toEqual([]);

    await writeFile(join(String(dir), "lib", "index.js"), "export const v = 2;");
    expect(await stdout.until(line => line.startsWith("RUN"))).toBe("RUN 2");

    proc.kill("SIGKILL");
    await proc.exited;
  });

  test.concurrent("a caught miss does not rerun on a sibling that cannot satisfy it", async () => {
    // `./db` is probed and not found. The resolver never tries `db.sqlite-journal` for it.
    await using dir = tempDir("watch-probed-import", {
      "entry.js": `
        import { writeFileSync } from "node:fs";
        let db = "none";
        try { db = require("./db"); } catch {}
        console.log("RUN", db);
        writeFileSync("db.sqlite-journal", String(Date.now()));
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "--watch", "--no-clear-screen", "entry.js"],
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new LineReader(proc.stdout);

    expect(await stdout.until(line => line.startsWith("RUN"))).toBe("RUN none");
    // Same bounded window as above: a correct build prints nothing here.
    expect(await stdout.within(2000)).toEqual([]);

    await writeFile(join(String(dir), "db.js"), `module.exports = "found";`);
    expect(await stdout.until(line => line.startsWith("RUN"))).toBe("RUN found");

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
    const stdout = new LineReader(proc.stdout);
    const stderr = new LineReader(proc.stderr);
    const isResolveError = (line: string) => line.includes('Could not resolve: "./a.js"');

    await stderr.until(isResolveError);

    // An edit to an import that did resolve rebuilds while a.js is missing.
    await writeFile(join(String(dir), "b.js"), "export const b = 30;");
    await stderr.until(isResolveError);

    // Creating the missing file rebuilds with both edits.
    await writeFile(join(String(dir), "a.js"), "export const a = 10;");
    // The per-file row is printed after the file is written.
    await stdout.until(line => line.includes("entry.js") && line.includes("(entry point)"));
    const bundle = await Bun.file(join(String(dir), "out", "entry.js")).text();
    expect(bundle).toContain("var a = 10");
    expect(bundle).toContain("var b = 30");

    proc.kill("SIGKILL");
    await proc.exited;
  });
});
