// https://github.com/oven-sh/bun/issues/2900
// Node sets process.argv[1] to path.resolve of what the user typed: absolute,
// ".."/"." collapsed, trailing separator stripped, symlinks NOT resolved.
// Module loading realpaths separately, so import.meta.url / Bun.main reflect
// the real file while argv[1] reflects what was invoked.
import { describe, expect, test } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

const printEntry = `console.log(JSON.stringify({
  argv1: process.argv[1],
  url: import.meta.url,
  metaMain: import.meta.main,
  bunMain: Bun.main,
}));`;

async function run(cwd: string, arg: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), arg],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe.concurrent("process.argv[1] is path.resolve of the entry argument", () => {
  describe.skipIf(isWindows)("symlinked entry keeps the link path", () => {
    test.each([
      ["relative", "bar.mjs"],
      ["dot-relative", "./bar.mjs"],
      ["absolute", null],
    ])("via %s path", async (_label, argOverride) => {
      using dir = tempDir("argv-symlink", { "foo.mjs": printEntry });
      const root = String(dir);
      const fooPath = join(root, "foo.mjs");
      const barPath = join(root, "bar.mjs");
      symlinkSync("foo.mjs", barPath);

      const { stdout, stderr, exitCode } = await run(root, argOverride ?? barPath);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        argv1: barPath,
        url: pathToFileURL(fooPath).href,
        metaMain: true,
        bunMain: fooPath,
      });
      expect(exitCode).toBe(0);
    });

    test("across directories", async () => {
      using dir = tempDir("argv-symlink-xdir", {
        "pkg/real.mjs": printEntry,
        "bin/.keep": "",
      });
      const root = String(dir);
      const realPath = join(root, "pkg", "real.mjs");
      const linkPath = join(root, "bin", "tool.mjs");
      symlinkSync(join("..", "pkg", "real.mjs"), linkPath);

      const { stdout, stderr, exitCode } = await run(root, join("bin", "tool.mjs"));

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        argv1: linkPath,
        url: pathToFileURL(realPath).href,
        metaMain: true,
        bunMain: realPath,
      });
      expect(exitCode).toBe(0);
    });

    test("collapses .. without resolving the symlink", async () => {
      using dir = tempDir("argv-symlink-dotdot", { "foo.mjs": printEntry, "sub/.keep": "" });
      const root = String(dir);
      const fooPath = join(root, "foo.mjs");
      const barPath = join(root, "bar.mjs");
      symlinkSync("foo.mjs", barPath);

      const { stdout, stderr, exitCode } = await run(root, "./sub/../bar.mjs");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        argv1: barPath,
        url: pathToFileURL(fooPath).href,
        metaMain: true,
        bunMain: fooPath,
      });
      expect(exitCode).toBe(0);
    });

    test("resolver path (symlink with no extension)", async () => {
      using dir = tempDir("argv-symlink-noext", { "foo.mjs": printEntry });
      const root = String(dir);
      const fooPath = join(root, "foo.mjs");
      const linkPath = join(root, "linked");
      symlinkSync("foo.mjs", linkPath);

      const { stdout, stderr, exitCode } = await run(root, "linked");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        argv1: linkPath,
        url: pathToFileURL(fooPath).href,
        metaMain: true,
        bunMain: fooPath,
      });
      expect(exitCode).toBe(0);
    });

    test("Bun.$ positional $1 agrees with process.argv[1]", async () => {
      using dir = tempDir("argv-symlink-shell", {
        "foo.mjs": `
          import { $ } from "bun";
          const shell1 = (await $\`echo $1\`.text()).trim();
          console.log(JSON.stringify({ argv1: process.argv[1], shell1 }));
        `,
      });
      const root = String(dir);
      const barPath = join(root, "bar.mjs");
      symlinkSync("foo.mjs", barPath);

      const { stdout, stderr, exitCode } = await run(root, "bar.mjs");

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ argv1: barPath, shell1: barPath });
      expect(exitCode).toBe(0);
    });
  });

  test.each([
    ["directory -> index.js", "./pkg", "pkg"],
    ["directory with trailing slash", "./pkg/", "pkg"],
  ])("resolver path (%s)", async (_label, arg, argvBasename) => {
    using dir = tempDir("argv-index", { "pkg/index.js": printEntry });
    const root = String(dir);
    const indexPath = join(root, "pkg", "index.js");

    const { stdout, stderr, exitCode } = await run(root, arg);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      argv1: join(root, argvBasename),
      url: pathToFileURL(indexPath).href,
      metaMain: true,
      bunMain: indexPath,
    });
    expect(exitCode).toBe(0);
  });

  test("resolver path (extension added)", async () => {
    using dir = tempDir("argv-ext", { "entry.ts": printEntry });
    const root = String(dir);
    const entryPath = join(root, "entry.ts");

    const { stdout, stderr, exitCode } = await run(root, "./entry");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      argv1: join(root, "entry"),
      url: pathToFileURL(entryPath).href,
      metaMain: true,
      bunMain: entryPath,
    });
    expect(exitCode).toBe(0);
  });

  test("non-symlink entry reports its own absolute path", async () => {
    using dir = tempDir("argv-plain", { "foo.mjs": printEntry });
    const root = String(dir);
    const fooPath = join(root, "foo.mjs");

    const { stdout, stderr, exitCode } = await run(root, "foo.mjs");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      argv1: fooPath,
      url: pathToFileURL(fooPath).href,
      metaMain: true,
      bunMain: fooPath,
    });
    expect(exitCode).toBe(0);
  });
});
