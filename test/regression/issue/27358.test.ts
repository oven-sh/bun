import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27358
// fetch() with TLS client certificates (mTLS) leaked SSLConfig objects
// because the SSL context cache hit path didn't free the duplicate config.
test("fetch() with mTLS client certs reuses SSL context correctly", async () => {
  using dir = tempDir("mtls-leak-test", {
    "generate-certs.sh": `#!/bin/bash
set -e
openssl req -x509 -newkey rsa:2048 -keyout ca.key -out ca.crt -days 1 -nodes -subj "/CN=TestCA" 2>/dev/null
openssl req -newkey rsa:2048 -keyout server.key -out server.csr -nodes -subj "/CN=localhost" 2>/dev/null
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 1 2>/dev/null
openssl req -newkey rsa:2048 -keyout client.key -out client.csr -nodes -subj "/CN=client" 2>/dev/null
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 1 2>/dev/null
`,
    "test.ts": `
import fs from "fs";
import path from "path";

const dir = process.argv[2];
const serverCert = fs.readFileSync(path.join(dir, "server.crt"), "utf-8");
const serverKey = fs.readFileSync(path.join(dir, "server.key"), "utf-8");
const clientCert = fs.readFileSync(path.join(dir, "client.crt"), "utf-8");
const clientKey = fs.readFileSync(path.join(dir, "client.key"), "utf-8");
const caCert = fs.readFileSync(path.join(dir, "ca.crt"), "utf-8");

const server = Bun.serve({
  port: 0,
  tls: { cert: serverCert, key: serverKey, ca: caCert },
  fetch() { return new Response("ok"); },
});

const url = "https://localhost:" + String(server.port) + "/";

// Make many requests with client certs to exercise SSL context caching.
// Before the fix, each request leaked an SSLConfig allocation (~3KB).
let successCount = 0;
for (let i = 0; i < 500; i++) {
  const res = await fetch(url, {
    tls: { cert: clientCert, key: clientKey, rejectUnauthorized: false },
  });
  const text = await res.text();
  if (text === "ok") successCount++;
}

server.stop();

console.log(JSON.stringify({ successCount }));
process.exit(0);
`,
  });

  // Generate certs
  const genProc = Bun.spawnSync({
    cmd: ["bash", "generate-certs.sh"],
    cwd: String(dir),
    stderr: "pipe",
  });
  expect(genProc.exitCode).toBe(0);

  // Run the test in a subprocess
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts", String(dir)],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    console.error("stderr:", stderr);
  }

  const result = JSON.parse(stdout.trim());
  expect(result.successCount).toBe(500);
  expect(exitCode).toBe(0);
}, 60_000);
