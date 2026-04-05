import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/28716
// http2.connect with an IP address and servername: '' should not fail with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. Per RFC 6066, IP addresses must not be
// sent as SNI; an empty servername should suppress SNI entirely.

test.concurrent("http2.connect with IP address and servername: '' connects successfully", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http2 = require('http2');
      const session = http2.connect('https://1.1.1.1', { servername: '' });
      session.once('error', (err) => {
        console.error(err.code);
        session.close();
        process.exit(1);
      });
      session.once('remoteSettings', () => {
        console.log(JSON.stringify(session.originSet));
        session.close();
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  const origins = JSON.parse(stdout.trim());
  expect(origins).toBeArrayOfSize(1);
  expect(origins[0]).toStartWith("https://1.1.1.1");
  expect(exitCode).toBe(0);
});

test.concurrent("tls.connect with IP address and servername: '' connects successfully", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tls = require('tls');
      const socket = tls.connect({ host: '1.1.1.1', port: 443, servername: '' }, () => {
        console.log('authorized:' + socket.authorized);
        socket.destroy();
      });
      socket.once('error', (err) => {
        console.error(err.code);
        process.exit(1);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  expect(stdout.trim()).toBe("authorized:true");
  expect(exitCode).toBe(0);
});

test.concurrent("tls.connect with IP address and no servername connects successfully", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const tls = require('tls');
      const socket = tls.connect({ host: '1.1.1.1', port: 443 }, () => {
        console.log('authorized:' + socket.authorized);
        socket.destroy();
      });
      socket.once('error', (err) => {
        console.error(err.code);
        process.exit(1);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  expect(stdout.trim()).toBe("authorized:true");
  expect(exitCode).toBe(0);
});
