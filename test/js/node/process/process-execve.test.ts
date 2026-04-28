import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe("process.execve", () => {
  test("is a function", () => {
    expect(typeof process.execve).toBe("function");
  });

  test.skipIf(isWindows)("replaces the current process image", async () => {
    using dir = tempDir("process-execve", {
      "index.js": `
        if (process.argv[2] === "replaced") {
          if (process.env.EXECVE_A !== "FIRST") throw new Error("env A mismatch: " + process.env.EXECVE_A);
          if (process.env.EXECVE_B !== "SECOND") throw new Error("env B mismatch: " + process.env.EXECVE_B);
          console.log("REPLACED:" + process.argv[2]);
        } else {
          process.on("exit", () => { throw new Error("exit handler should not fire"); });
          process.execve(
            process.execPath,
            [process.execPath, __filename, "replaced"],
            { ...process.env, EXECVE_A: "FIRST", EXECVE_B: "SECOND" },
          );
          throw new Error("execve returned unexpectedly");
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("exit handler should not fire");
    expect(stderr).not.toContain("execve returned unexpectedly");
    expect(stdout.trim()).toBe("REPLACED:replaced");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("throws ERR_WORKER_UNSUPPORTED_OPERATION in a worker", async () => {
    using dir = tempDir("process-execve-worker", {
      "index.js": `
        const { Worker, isMainThread, parentPort } = require("worker_threads");
        if (isMainThread) {
          const w = new Worker(__filename);
          w.on("message", (m) => { console.log(m); process.exit(0); });
          w.on("error", (e) => { console.error("WORKER_ERROR:" + e.message); process.exit(1); });
        } else {
          try {
            process.execve(process.execPath, [process.execPath], {});
            parentPort.postMessage("FAIL:no-throw");
          } catch (e) {
            parentPort.postMessage("CODE:" + e.code + ":NAME:" + e.name);
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("WORKER_ERROR");
    expect(stdout.trim()).toBe("CODE:ERR_WORKER_UNSUPPORTED_OPERATION:NAME:TypeError");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("aborts with ENOENT when the path does not exist", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.execve(process.execPath + "_does_not_exist", [process.execPath], { ...process.env });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("process.execve failed with error code ENOENT");
    expect(exitCode).not.toBe(0);
  });

  test.skipIf(isWindows)("closes listening sockets in the replacement process", async () => {
    using dir = tempDir("process-execve-socket", {
      "index.js": `
        const { createServer } = require("net");
        if (process.argv[2] === "replaced") {
          const port = parseInt(process.env.PORT, 10);
          const server = createServer();
          server.on("error", (e) => { console.error("LISTEN_ERROR:" + e.code); process.exit(1); });
          server.listen(port, () => {
            console.log("RELISTENED:" + port);
            server.close();
          });
        } else {
          const server = createServer();
          server.listen(0, () => {
            const port = server.address().port;
            process.execve(
              process.execPath,
              [process.execPath, __filename, "replaced"],
              { ...process.env, PORT: String(port) },
            );
          });
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("LISTEN_ERROR");
    expect(stdout).toContain("RELISTENED:");
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("validates arguments", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const codes = [];
          try { process.execve(123); } catch (e) { codes.push(e.code); }
          try { process.execve(process.execPath, "123"); } catch (e) { codes.push(e.code); }
          try { process.execve(process.execPath, [123]); } catch (e) { codes.push(e.code); }
          try { process.execve(process.execPath, ["a\\u0000b"]); } catch (e) { codes.push(e.code); }
          try { process.execve(process.execPath, [], "123"); } catch (e) { codes.push(e.code); }
          try { process.execve(process.execPath, [], { abc: 123 }); } catch (e) { codes.push(e.code); }
          try { process.execve(process.execPath, [], { abc: "a\\u0000b" }); } catch (e) { codes.push(e.code); }
          console.log(JSON.stringify(codes));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(stdout.trim())).toEqual([
      "ERR_INVALID_ARG_TYPE",
      "ERR_INVALID_ARG_TYPE",
      "ERR_INVALID_ARG_VALUE",
      "ERR_INVALID_ARG_VALUE",
      "ERR_INVALID_ARG_TYPE",
      "ERR_INVALID_ARG_VALUE",
      "ERR_INVALID_ARG_VALUE",
    ]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isWindows)("throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM on Windows", () => {
    expect(() => process.execve(process.execPath, [process.execPath], {})).toThrow(
      expect.objectContaining({
        code: "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM",
        name: "TypeError",
      }),
    );
  });
});
