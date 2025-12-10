import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("response.socket should have authorized property for HTTPS requests - issue #23452", async () => {
  const testScript = `
const http = require('http');
const https = require('https');

// Test HTTPS request
https.get('https://example.com', (res) => {
  console.log('encrypted:', res.socket.encrypted);
  console.log('authorized:', res.socket.authorized);
  console.log('authorized type:', typeof res.socket.authorized);

  if (res.socket.encrypted !== true) {
    process.exit(1);
  }

  if (typeof res.socket.authorized !== 'boolean') {
    console.error('ERROR: authorized should be a boolean, got:', typeof res.socket.authorized);
    process.exit(2);
  }

  // For a successful HTTPS connection with valid cert, authorized should be true
  if (res.socket.authorized !== true) {
    console.error('ERROR: authorized should be true for valid HTTPS connection');
    process.exit(3);
  }

  res.resume();
  res.on('end', () => {
    console.log('SUCCESS');
    process.exit(0);
  });
}).on('error', (err) => {
  console.error('Request failed:', err);
  process.exit(4);
});
`;

  const dir = join(tmpdir(), "bun-test-23452-" + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, "test.js");
  await Bun.write(scriptPath, testScript);

  const proc = Bun.spawn({
    cmd: [bunExe(), scriptPath],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  console.log("stdout:", stdout);
  console.log("stderr:", stderr);
  console.log("exitCode:", exitCode);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("encrypted: true");
  expect(stdout).toContain("authorized: true");
  expect(stdout).toContain("authorized type: boolean");
  expect(stdout).toContain("SUCCESS");
});
