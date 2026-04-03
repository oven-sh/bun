import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27784
test("http server listen callback fires after EADDRINUSE retry", async () => {
  // Script that blocks a port, then tests the Vite-style retry pattern
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require('http');
const host = '127.0.0.1';

// Block a port
const blocker = http.createServer();
blocker.listen(0, host, () => {
  const blockedPort = blocker.address().port;

  const server = http.createServer();

  const promise = new Promise((resolve, reject) => {
    let retried = false;
    const onError = (e) => {
      if (e.code === 'EADDRINUSE' && !retried) {
        retried = true;
        // Retry on next port (Vite pattern)
        server.listen(blockedPort + 1, host);
      } else {
        server.removeListener('error', onError);
        reject(e);
      }
    };

    server.on('error', onError);

    // listen with callback — the callback must fire even after retry
    server.listen(blockedPort, host, () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    });
  });

  promise.then(port => {
    console.log(JSON.stringify({ port, blockedPort }));
    server.close();
    blocker.close();
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.port).toBe(result.blockedPort + 1);
  expect(exitCode).toBe(0);
});
