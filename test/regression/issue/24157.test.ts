import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for GitHub issue #24157
// UDP socket sharing in cluster mode is not supported in Bun.
// This test verifies that a clear error is thrown explaining the limitation
// and suggests using the exclusive option.

test("dgram.bind in cluster worker without exclusive throws clear error", async () => {
  using dir = tempDir("dgram-cluster", {
    "main.mjs": `
import cluster from 'node:cluster';
import dgram from 'node:dgram';

if (cluster.isPrimary) {
  const worker = cluster.fork();

  worker.on('exit', (code) => {
    process.exit(code);
  });

  setTimeout(() => {
    console.log('ERROR: Timeout');
    worker.kill();
    process.exit(2);
  }, 5000);
} else {
  const s = dgram.createSocket('udp4');

  s.on('error', (err) => {
    if (err.message.includes('UDP socket sharing in cluster mode is not yet supported')) {
      console.log('SUCCESS: Got expected error about unsupported feature');
      process.exit(0);
    } else {
      console.log('UNEXPECTED ERROR:', err.message);
      process.exit(1);
    }
  });

  s.on('listening', () => {
    console.log('ERROR: Socket bound unexpectedly');
    s.close();
    process.exit(1);
  });

  // Try to bind without exclusive - should fail with clear error
  s.bind(1234);
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(stdout).toContain("SUCCESS: Got expected error about unsupported feature");
  expect(exitCode).toBe(0);
});

test("dgram.bind in cluster worker with exclusive: true succeeds", async () => {
  using dir = tempDir("dgram-cluster-exclusive", {
    "main.mjs": `
import cluster from 'node:cluster';
import dgram from 'node:dgram';

if (cluster.isPrimary) {
  const worker = cluster.fork();

  worker.on('exit', (code) => {
    process.exit(code);
  });

  setTimeout(() => {
    console.log('ERROR: Timeout');
    worker.kill();
    process.exit(2);
  }, 5000);
} else {
  const s = dgram.createSocket('udp4');

  s.on('error', (err) => {
    console.log('ERROR:', err.message);
    process.exit(1);
  });

  s.on('listening', () => {
    console.log('SUCCESS: Socket bound with exclusive option');
    s.close();
    process.exit(0);
  });

  // Bind with exclusive: true - should work
  s.bind({ port: 0, exclusive: true });
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(stdout).toContain("SUCCESS: Socket bound with exclusive option");
  expect(exitCode).toBe(0);
});

test("dgram.bind in cluster worker with reusePort: true succeeds", async () => {
  using dir = tempDir("dgram-cluster-reuseport", {
    "main.mjs": `
import cluster from 'node:cluster';
import dgram from 'node:dgram';

if (cluster.isPrimary) {
  const worker = cluster.fork();

  worker.on('exit', (code) => {
    process.exit(code);
  });

  setTimeout(() => {
    console.log('ERROR: Timeout');
    worker.kill();
    process.exit(2);
  }, 5000);
} else {
  // reusePort: true automatically sets exclusive to true
  const s = dgram.createSocket({ type: 'udp4', reusePort: true });

  s.on('error', (err) => {
    console.log('ERROR:', err.message);
    process.exit(1);
  });

  s.on('listening', () => {
    console.log('SUCCESS: Socket bound with reusePort option');
    s.close();
    process.exit(0);
  });

  s.bind(0);
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(stdout).toContain("SUCCESS: Socket bound with reusePort option");
  expect(exitCode).toBe(0);
});

test("addMembership on same socket twice throws EADDRINUSE", async () => {
  // This tests that the basic addMembership error propagation works
  // when a single socket tries to join the same multicast group twice
  using dir = tempDir("dgram-membership-same-socket", {
    "main.mjs": `
import dgram from 'node:dgram';

const s = dgram.createSocket('udp4');
s.bind(0, () => {
  try {
    s.addMembership('224.0.0.114');
    console.log('First addMembership succeeded');
  } catch (err) {
    console.log('ERROR: First addMembership failed:', err.code);
    s.close();
    process.exit(1);
  }

  try {
    s.addMembership('224.0.0.114');
    console.log('ERROR: Second addMembership should have failed');
    s.close();
    process.exit(1);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('SUCCESS: Second addMembership threw EADDRINUSE');
      s.close();
      process.exit(0);
    } else {
      console.log('ERROR: Unexpected error code:', err.code);
      s.close();
      process.exit(1);
    }
  }
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }

  expect(stdout).toContain("SUCCESS: Second addMembership threw EADDRINUSE");
  expect(exitCode).toBe(0);
});
