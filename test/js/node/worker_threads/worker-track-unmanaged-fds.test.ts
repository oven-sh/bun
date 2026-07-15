import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// trackUnmanagedFds: fs.open/openSync fds left open in a worker must be closed when the
// worker exits (default / true), and must be left alone when the user opts out (false).
// Verified by inode identity so fd-number reuse can never fake a verdict. Windows is
// skipped because workers receive uv-tagged fd numbers that don't map 1:1 to parent fds.
describe.concurrent.skipIf(isWindows)("Worker trackUnmanagedFds", () => {
  async function probe(openHow: "sync" | "async", closeIt: boolean, opts: string) {
    const worker =
      `const { parentPort, workerData } = require("node:worker_threads");` +
      `const fs = require("node:fs");` +
      `const done = fd => {` +
      `  if (workerData.closeIt) fs.closeSync(fd);` +
      `  parentPort.postMessage({ fd });` +
      `};` +
      `if (workerData.openHow === "sync") done(fs.openSync(workerData.target, "r"));` +
      `else fs.open(workerData.target, "r", (e, fd) => done(fd));`;
    const fixture = `
      const { Worker } = require("node:worker_threads");
      const fs = require("node:fs");
      const path = require("node:path");
      const target = path.join(process.cwd(), "probe.txt");
      fs.writeFileSync(target, "x");
      const ino = fs.statSync(target).ino;
      const points = fd => {
        try { return fs.fstatSync(fd).ino === ino; } catch { return false; }
      };
      const w = new Worker(${JSON.stringify(worker)}, {
        eval: true,
        workerData: { target, openHow: ${JSON.stringify(openHow)}, closeIt: ${closeIt} },
        ...${opts},
      });
      w.on("error", e => { console.error(e); process.exit(1); });
      w.on("message", m => {
        const during = ${closeIt} || points(m.fd);
        w.on("exit", () => console.log(JSON.stringify({ during, after: points(m.fd) })));
        w.terminate();
      });
    `;
    using dir = tempDir("worker-track-unmanaged-fds", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, out: JSON.parse(stdout || "null"), exitCode };
  }

  test("fs.openSync fd is auto-closed at worker exit by default", async () => {
    expect(await probe("sync", false, "{}")).toEqual({
      stderr: "",
      // during=true proves the fd was live (confound guard); after=false proves the sweep closed it.
      out: { during: true, after: false },
      exitCode: 0,
    });
  });

  test("fs.openSync fd is auto-closed when trackUnmanagedFds: true", async () => {
    expect(await probe("sync", false, "{ trackUnmanagedFds: true }")).toEqual({
      stderr: "",
      out: { during: true, after: false },
      exitCode: 0,
    });
  });

  test("fs.openSync fd survives worker exit when trackUnmanagedFds: false", async () => {
    expect(await probe("sync", false, "{ trackUnmanagedFds: false }")).toEqual({
      stderr: "",
      out: { during: true, after: true },
      exitCode: 0,
    });
  });

  test("fs.open (callback) fd is auto-closed at worker exit", async () => {
    expect(await probe("async", false, "{}")).toEqual({
      stderr: "",
      out: { during: true, after: false },
      exitCode: 0,
    });
  });

  test("fs.closeSync drops the fd from tracking (no double-close)", async () => {
    expect(await probe("sync", true, "{}")).toEqual({
      stderr: "",
      out: { during: true, after: false },
      exitCode: 0,
    });
  });
});
