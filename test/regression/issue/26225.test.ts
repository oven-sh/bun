import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Loading form-data (and the mime-db table behind it) in the child takes ~3s on
// a debug build, which is most of the default per-test budget.
setDefaultTimeout(30_000);

// https://github.com/oven-sh/bun/issues/26225
// Multipart uploads using form-data + node-fetch@2 + fs.createReadStream() are truncated
//
// `node-fetch` always resolves to Bun's bundled implementation (the one this
// issue is about), so nothing needs to be installed for it. `form-data` is the
// real npm package from test/node_modules, required by absolute path; its
// CombinedStream body is the old-style stream that used to get truncated.
const formDataPath = require.resolve("form-data");

async function runClient(name: string, clientJs: string) {
  using dir = tempDir(name, { "client.js": clientJs });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "client.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("node-fetch with form-data and fs.createReadStream works correctly", async () => {
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

  const { stdout, stderr, exitCode } = await runClient(
    "test-26225",
    `
const fs = require('fs');
const path = require('path');
const FormData = require(${JSON.stringify(formDataPath)});
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
  );

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ success: true, bytesReceived: 1024, contentValid: true });
  expect(exitCode).toBe(0);
});

// Test that regular async iterables still work
test.concurrent("node-fetch with async iterable body still works", async () => {
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

  const { stdout, stderr, exitCode } = await runClient(
    "test-26225-async",
    `
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
  );

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ success: true, bytesReceived: 13, content: "Hello, World!" });
  expect(exitCode).toBe(0);
});

// Test with larger file to ensure streaming works
test.concurrent("node-fetch with form-data and large file stream", async () => {
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

  const { stdout, stderr, exitCode } = await runClient(
    "test-26225-large",
    `
const fs = require('fs');
const path = require('path');
const FormData = require(${JSON.stringify(formDataPath)});
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
  );

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ success: true, bytesReceived: fileSize, contentValid: true });
  expect(exitCode).toBe(0);
});
