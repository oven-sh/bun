import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// These tests install npm packages, so they need a longer timeout
setDefaultTimeout(30_000);

// Test for GitHub issue #26225
// Multipart uploads using form-data + node-fetch@2 + fs.createReadStream() are truncated
test("node-fetch with form-data and fs.createReadStream works correctly", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof Blob)) {
        return new Response(JSON.stringify({ success: false, error: "No file found" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const content = await file.text();
      return new Response(
        JSON.stringify({
          success: true,
          bytesReceived: file.size,
          contentValid: content === "A".repeat(1024),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });

  using dir = tempDir("test-26225", {
    "package.json": JSON.stringify({
      name: "test-26225",
      dependencies: {
        "form-data": "^4.0.0",
        "node-fetch": "^2.7.0",
      },
    }),
    "client.js": `
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const tmpFile = path.join(__dirname, 'test.txt');
fs.writeFileSync(tmpFile, 'A'.repeat(1024));

const form = new FormData();
form.append('file', fs.createReadStream(tmpFile));

fetch('http://localhost:${server.port}', {
  method: 'POST',
  body: form,
  headers: form.getHeaders(),
})
  .then(r => r.json())
  .then(r => {
    console.log(JSON.stringify(r));
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
`,
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Run the client
  const proc = Bun.spawn({
    cmd: [bunExe(), "client.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (stderr) {
    console.error("stderr:", stderr);
  }
  if (!stdout.trim()) {
    console.error("stdout was empty, exit code:", exitCode);
  }

  expect(stdout.trim()).not.toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.success).toBe(true);
  expect(result.bytesReceived).toBe(1024);
  expect(result.contentValid).toBe(true);
  expect(exitCode).toBe(0);
});

// Test that regular async iterables still work
test("node-fetch with async iterable body still works", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const text = await req.text();
      return new Response(
        JSON.stringify({
          success: true,
          bytesReceived: text.length,
          content: text,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });

  using dir = tempDir("test-26225-async", {
    "package.json": JSON.stringify({
      name: "test-26225-async",
      dependencies: {
        "node-fetch": "^2.7.0",
      },
    }),
    "client.js": `
const fetch = require('node-fetch');

// Create an async iterable body
async function* generateBody() {
  yield 'Hello, ';
  yield 'World!';
}

fetch('http://localhost:${server.port}', {
  method: 'POST',
  body: generateBody(),
})
  .then(r => r.json())
  .then(r => console.log(JSON.stringify(r)))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
`,
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Run the client
  const proc = Bun.spawn({
    cmd: [bunExe(), "client.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (stderr) {
    console.error("stderr:", stderr);
  }

  expect(stdout.trim()).not.toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.success).toBe(true);
  expect(result.content).toBe("Hello, World!");
  expect(exitCode).toBe(0);
});

// Test with larger file to ensure streaming works
test("node-fetch with form-data and large file stream", async () => {
  const fileSize = 1024 * 100; // 100KB

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof Blob)) {
        return new Response(JSON.stringify({ success: false, error: "No file found" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const bytes = await file.arrayBuffer();
      // Verify all bytes are 'B' (0x42)
      const arr = new Uint8Array(bytes);
      let valid = arr.length === fileSize;
      for (let i = 0; valid && i < arr.length; i++) {
        if (arr[i] !== 0x42) valid = false;
      }
      return new Response(
        JSON.stringify({
          success: true,
          bytesReceived: file.size,
          contentValid: valid,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  });

  using dir = tempDir("test-26225-large", {
    "package.json": JSON.stringify({
      name: "test-26225-large",
      dependencies: {
        "form-data": "^4.0.0",
        "node-fetch": "^2.7.0",
      },
    }),
    "client.js": `
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const fileSize = ${fileSize};
const tmpFile = path.join(__dirname, 'test.bin');
fs.writeFileSync(tmpFile, Buffer.alloc(fileSize, 'B'));

const form = new FormData();
form.append('file', fs.createReadStream(tmpFile));

fetch('http://localhost:${server.port}', {
  method: 'POST',
  body: form,
  headers: form.getHeaders(),
})
  .then(r => r.json())
  .then(r => {
    console.log(JSON.stringify(r));
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
`,
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Run the client
  const proc = Bun.spawn({
    cmd: [bunExe(), "client.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (stderr) {
    console.error("stderr:", stderr);
  }

  expect(stdout.trim()).not.toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.success).toBe(true);
  expect(result.bytesReceived).toBe(fileSize);
  expect(result.contentValid).toBe(true);
  expect(exitCode).toBe(0);
});
