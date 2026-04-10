import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// net.Socket({fd}) on a pipe fd is duplex: writeBuffer/writeUtf8String go
// through the native Pipe handle's StreamingWriter, readStart/onread through
// its BufferedReader. We get cross-platform pipe fds by spawning a child whose
// stdin/stdout are pipes; the child wraps fd 0 (read) and fd 1 (write) in
// net.Socket and reports what it observes.
test("net.Socket({fd}) write+read on pipe fds", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Socket } = require("net");

        // fd 1 is the write end of the parent's stdout pipe.
        const out = new Socket({ fd: 1, readable: false });
        if (out._handle?.constructor.name !== "Pipe") {
          throw new Error("fd 1 _handle is " + out._handle?.constructor.name);
        }
        // fd 0 is the read end of the parent's stdin pipe.
        const inp = new Socket({ fd: 0, writable: false });
        if (inp._handle?.constructor.name !== "Pipe") {
          throw new Error("fd 0 _handle is " + inp._handle?.constructor.name);
        }

        let buf = "";
        inp.setEncoding("utf8");
        inp.on("data", d => (buf += d));
        inp.on("end", () => {
          out.write("[received:" + buf + "]", err => {
            if (err) throw err;
            out.write("[bytesWritten:" + out._handle.bytesWritten + "]", err2 => {
              if (err2) throw err2;
              out.end();
            });
          });
        });
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("hello-via-pipe");
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\[received:hello-via-pipe\]\[bytesWritten:(\d+)\]$/);
  const bytesWritten = Number(stdout.match(/bytesWritten:(\d+)/)![1]);
  expect(bytesWritten).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});
