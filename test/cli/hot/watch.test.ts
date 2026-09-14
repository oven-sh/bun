import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/42701
test.skipIf(isWindows)("--watch does not keep an fd per symlink path under node_modules", async () => {
  // The layout of `bun install --linker=isolated`: N dependents that each
  // reach one shared package through their own
  // `node_modules/.bun/<dep>/node_modules/shared` symlink.
  const N = 64;
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "proj", type: "module" }),
    "node_modules/.bun/shared@1.0.0/node_modules/shared/package.json": JSON.stringify({
      name: "shared",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./dist/esm/index.js" },
    }),
    "node_modules/.bun/shared@1.0.0/node_modules/shared/dist/esm/index.js": "export const shared = 1;",
  };
  let entry = "";
  for (let i = 0; i < N; i++) {
    files[`node_modules/.bun/dep${i}@1.0.0/node_modules/dep${i}/package.json`] = JSON.stringify({
      name: `dep${i}`,
      version: "1.0.0",
      type: "module",
      main: "index.js",
    });
    files[`node_modules/.bun/dep${i}@1.0.0/node_modules/dep${i}/index.js`] =
      'import { shared } from "shared"; export const v = shared;';
    entry += `import "dep${i}";\n`;
  }
  entry += `
    import { readdirSync } from "node:fs";
    console.log("OPEN_FDS=" + readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length);
    process.exit(0);
  `;
  files["index.ts"] = entry;
  using dir = tempDir("watch-isolated-fds", files);
  for (let i = 0; i < N; i++) {
    symlinkSync(
      "../../shared@1.0.0/node_modules/shared",
      join(String(dir), `node_modules/.bun/dep${i}@1.0.0/node_modules/shared`),
    );
    symlinkSync(`.bun/dep${i}@1.0.0/node_modules/dep${i}`, join(String(dir), `node_modules/dep${i}`));
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Unfixed, the resolver keeps about 9 fds per dependent, all under
  // node_modules. The watcher never watches anything there, so none of
  // them may stay open.
  expect(stderr).toBe("");
  expect(Number(stdout.match(/OPEN_FDS=(\d+)/)?.[1])).toBeLessThan(N);
  expect(exitCode).toBe(0);
});

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
