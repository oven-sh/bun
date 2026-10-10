import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/39787
// https://github.com/oven-sh/bun/issues/41850
// On Windows, a Bun.file() read settled its promise inside a libuv callback
// with no microtask checkpoint. If the read was the only pending work, the
// process exited 0 before the await continuation ran. The fix is in the
// Windows-only libuv read path, so the tests only run there.
describe.skipIf(!isWindows)("a Bun.file() read runs its continuation before the process exits", () => {
  async function run(script: string, stdin?: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdin: stdin === undefined ? "ignore" : "pipe",
      stderr: "pipe",
    });
    if (stdin !== undefined) {
      proc.stdin.write(stdin);
      await proc.stdin.end();
    }
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    return { stdout, exitCode };
  }

  test.concurrent.each(["text", "json", "bytes", "arrayBuffer"])("awaited .%s() on a missing file", async method => {
    using dir = tempDir("issue-39787", {});
    const missing = join(String(dir), "definitely-missing-file.txt");
    const { stdout, exitCode } = await run(`async function main() {
      try {
        await Bun.file(${JSON.stringify(missing)}).${method}();
        console.log("UNEXPECTED RESOLVE");
      } catch (e) {
        console.log("CAUGHT " + e.code);
      }
      console.log("DONE");
    }
    main();`);
    expect(stdout).toBe("CAUGHT ENOENT\nDONE\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a .catch().then() chain on a missing file with no await", async () => {
    using dir = tempDir("issue-39787", {});
    const missing = join(String(dir), "definitely-missing-file.txt");
    const { stdout, exitCode } = await run(
      `Bun.file(${JSON.stringify(missing)}).json().catch(e => console.log("CAUGHT " + e.code)).then(() => console.log("DONE"));`,
    );
    expect(stdout).toBe("CAUGHT ENOENT\nDONE\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("beforeExit and exit fire after the continuation", async () => {
    using dir = tempDir("issue-39787", {});
    const missing = join(String(dir), "definitely-missing-file.txt");
    const { stdout, exitCode } = await run(`process.on("beforeExit", c => console.log("BEFOREEXIT " + c));
    process.on("exit", c => console.log("EXIT " + c));
    async function main() {
      try {
        await Bun.file(${JSON.stringify(missing)}).text();
      } catch (e) {
        console.log("CAUGHT " + e.code);
      }
      console.log("DONE");
    }
    main();`);
    expect(stdout).toBe("CAUGHT ENOENT\nDONE\nBEFOREEXIT 0\nEXIT 0\n");
    expect(exitCode).toBe(0);
  });

  // The success path used to drain only because the async close of the fd kept
  // the loop alive one more iteration.
  test.concurrent("awaited .text() on an existing file", async () => {
    using dir = tempDir("issue-39787", { "exists.txt": "hello" });
    const existing = join(String(dir), "exists.txt");
    const { stdout, exitCode } = await run(`async function main() {
      console.log("READ " + (await Bun.file(${JSON.stringify(existing)}).text()));
      console.log("DONE");
    }
    main();`);
    expect(stdout).toBe("READ hello\nDONE\n");
    expect(exitCode).toBe(0);
  });

  // Bun.stdin is a file-descriptor Blob, so its read takes the same path. With
  // no fd to close after the read, nothing else kept the loop alive.
  test.concurrent("awaited Bun.stdin.text()", async () => {
    const { stdout, exitCode } = await run(
      `async function main() {
        console.log("READ " + JSON.stringify(await Bun.stdin.text()));
        console.log("DONE");
      }
      main();`,
      "hello\n",
    );
    expect(stdout).toBe('READ "hello\\n"\nDONE\n');
    expect(exitCode).toBe(0);
  });
});
