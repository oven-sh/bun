import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("process.binding", () => {
  test("process.binding('constants')", () => {
    /* @ts-ignore */
    const constants = process.binding("constants");
    expect(constants).toBeDefined();
    expect(constants).toHaveProperty("os");
    expect(constants).toHaveProperty("crypto");
    expect(constants).toHaveProperty("fs");
    expect(constants).toHaveProperty("trace");
    expect(constants).toHaveProperty("zlib");
  });
  test("process.binding('uv')", () => {
    /* @ts-ignore */
    const uv = process.binding("uv");
    expect(uv).toBeDefined();

    expect(uv).toHaveProperty("errname");
    expect(uv).toHaveProperty("UV_EACCES");
    // UV_EINTR is -4 on POSIX and a libuv-synthetic code on Windows.
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");
    // force the number to be represented as a double
    expect(uv.errname(uv.UV_EINTR - 1.9 + Number("1.9"))).toBe("EINTR");
    expect(uv.errname(uv.UV_EINTR)).toBe("EINTR");

    expect(uv.errname(5)).toBe("Unknown system error 5");

    const map = uv.getErrorMap();
    expect(map).toBeDefined();
    expect(map.get(uv.UV_EISCONN)).toEqual(["EISCONN", "socket is already connected"]);
  });

  // A pending worker.terminate() surfaces inside getErrorMap() at one of its ~85 array allocations.
  // This used to segfault the whole process, hence the subprocess. The timeout covers booting four
  // workers on debug and ASAN builds.
  const workerTerminateTimeout = 20_000;
  test(
    "process.binding('uv').getErrorMap() survives worker.terminate() landing mid-call",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { Worker } = require("node:worker_threads");
            const source = \`
              const { parentPort } = require("node:worker_threads");
              const uv = process.binding("uv");
              parentPort.postMessage("busy");
              for (;;) uv.getErrorMap();
            \`;
            const exitCodes = [];
            for (let i = 0; i < 4; i++) {
              const worker = new Worker(source, { eval: true });
              worker.on("message", () => worker.terminate());
              worker.on("exit", code => {
                exitCodes.push(code);
                if (exitCodes.length === 4) console.log(JSON.stringify(exitCodes));
              });
            }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("[1,1,1,1]\n");
      expect(exitCode).toBe(0);
    },
    workerTerminateTimeout,
  );
});
