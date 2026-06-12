import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { constants as osConstants } from "node:os";

// Requests a port that nothing is listening on and reports every "error"
// event of the request as JSON on exit. `requestOptions` is spread into the
// http.request options object.
async function runConnectionRefusedFixture(requestOptions: string) {
  const fixture = `
    const { request } = require("node:http");
    const net = require("node:net");
    // Grab a port that nothing is listening on.
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => {
        const errors = [];
        const req = request({ port, path: "/", ${requestOptions} });
        req.on("error", err => errors.push(err));
        req.end();
        process.on("exit", () => {
          const err = errors[0] ?? {};
          console.log(JSON.stringify({
            port,
            count: errors.length,
            name: err.name,
            message: err.message,
            code: err.code,
            errno: err.errno,
            syscall: err.syscall,
            address: err.address,
            errPort: err.port,
          }));
        });
      });
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { port, ...err } = JSON.parse(stdout.trim());
  expect(exitCode).toBe(0);
  return { port, err };
}

function expectedConnectionRefusedError(port: number) {
  // On POSIX, libuv reports -errno; on Windows it uses the synthetic
  // UV_ECONNREFUSED (-4078) rather than the CRT's ECONNREFUSED.
  const errno = process.platform === "win32" ? -4078 : -osConstants.errno.ECONNREFUSED;
  return {
    count: 1,
    name: "Error",
    message: `connect ECONNREFUSED 127.0.0.1:${port}`,
    code: "ECONNREFUSED",
    errno,
    syscall: "connect",
    address: "127.0.0.1",
    errPort: port,
  };
}

// https://github.com/oven-sh/bun/issues/32170
it("http.request ECONNREFUSED error has Node.js message and properties", async () => {
  const { port, err } = await runConnectionRefusedFixture(`host: "127.0.0.1"`);
  expect(err).toEqual(expectedConnectionRefusedError(port));
});

it("http.request with a custom lookup emits a single ECONNREFUSED error for the attempted address", async () => {
  // All resolved addresses are tried in turn; when every one of them is
  // refused, exactly one error must be emitted (like Node.js), and it must
  // name the address that was attempted, not the hostname.
  const { port, err } = await runConnectionRefusedFixture(`
    host: "localhost",
    lookup: (hostname, opts, callback) => {
      callback(null, [
        { address: "127.0.0.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    }
  `);
  expect(err).toEqual(expectedConnectionRefusedError(port));
});
