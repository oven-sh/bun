import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import os from "node:os";

// addMembership() without an interface argument asks the kernel to pick the
// default multicast route; containers with only loopback (or no default route)
// return ENODEV. Probe for a non-internal IPv4 address we can pass explicitly.
function findIPv4MulticastInterface(): string | undefined {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const { family, internal, address } of ifaces ?? []) {
      if (family === "IPv4" && !internal) return address;
    }
  }
  return undefined;
}
const multicastInterface = findIPv4MulticastInterface();

// https://github.com/oven-sh/bun/issues/24157
// Without reuseAddr, a second process should not be able to bind to the same
// UDP port. Previously, Bun unconditionally set SO_REUSEADDR on all UDP sockets
// when port != 0, allowing duplicate binds and masking EADDRINUSE errors from
// addMembership.
test("UDP bind throws EADDRINUSE without reuseAddr when port is in use", async () => {
  // First, find a free port by briefly binding to port 0 and closing.
  using dir = tempDir("dgram-24157-a", {
    "main.ts": `
      import dgram from 'node:dgram';
      import { spawn } from 'node:child_process';

      // Find a free port
      const tmp = dgram.createSocket('udp4');
      tmp.bind(0, () => {
        const port = tmp.address().port;
        tmp.close();

        // Now both parent and child bind to that specific non-zero port
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
        s.bind(port, () => {
          const child = spawn(process.execPath, [__dirname + '/child.ts', String(port)], {
            stdio: 'inherit'
          });
          child.on('close', () => {
            s.close();
          });
        });
        s.on('error', (err) => {
          console.log('parent-error:' + err.code);
        });
      });
    `,
    "child.ts": `
      import dgram from 'node:dgram';

      const port = parseInt(process.argv[2]);
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      s.bind(port, () => {
        console.log('child-bound:' + s.address().port);
        s.close();
      });
      s.on('error', (err) => {
        console.log('child-error:' + err.code);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The child should fail to bind with EADDRINUSE since reuseAddr is false
  expect(stdout).toContain("child-error:EADDRINUSE");
  expect(exitCode).toBe(0);
});

test.skipIf(!multicastInterface)("addMembership succeeds with reuseAddr: true", async () => {
  using dir = tempDir("dgram-24157-b", {
    "main.ts": `
      import dgram from 'node:dgram';
      import { spawn } from 'node:child_process';

      const iface = ${JSON.stringify(multicastInterface)};
      // Find a free port
      const tmp = dgram.createSocket('udp4');
      tmp.bind(0, () => {
        const port = tmp.address().port;
        tmp.close();

        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.bind(port, () => {
          try {
            s.addMembership('239.255.0.2', iface);
          } catch (e) {
            console.log('parent-error:' + (e.code || e.message));
            s.close();
            return;
          }
          const child = spawn(process.execPath, [__dirname + '/child.ts', String(port), iface], {
            stdio: 'inherit'
          });
          child.on('close', () => {
            s.close();
          });
        });
        s.on('error', (err) => {
          console.log('parent-error:' + (err.code || err.message));
        });
      });
    `,
    "child.ts": `
      import dgram from 'node:dgram';

      const port = parseInt(process.argv[2]);
      const iface = process.argv[3];
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.bind(port, () => {
        try {
          s.addMembership('239.255.0.2', iface);
          console.log('child-joined:' + s.address().port);
        } catch (e) {
          console.log('child-error:' + (e.code || e.message));
        }
        s.close();
      });
      s.on('error', (err) => {
        console.log('child-error:' + (err.code || err.message));
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // ENODEV from IP_ADD_MEMBERSHIP means the probed interface lacks multicast
  // capability (kernel-reported env limitation, unrelated to #24157's
  // SO_REUSEADDR regression — that's covered by the first test above).
  if (stdout.includes("parent-error:ENODEV") || stdout.includes("child-error:ENODEV")) {
    console.warn("skipping: no IPv4 multicast-capable interface (ENODEV from setsockopt)");
    return;
  }

  // With reuseAddr: true, both should succeed in joining the multicast group
  expect(stdout).toContain("child-joined:");
  expect(exitCode).toBe(0);
});
