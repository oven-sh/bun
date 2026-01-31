import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test for GitHub issue #26638
// First multipart upload over HTTPS corrupts the body when using request-promise + fs.createReadStream()
// The issue is that chunks can be lost due to race conditions between the TLS handshake timing
// and when data is piped to the ClientRequest.
describe("issue #26638", () => {
  test("node:https streaming body yields all chunks even when end() is called quickly", async () => {
    // This test simulates the race condition where:
    // 1. Multiple chunks are written quickly to the ClientRequest
    // 2. The request is ended before all chunks have been yielded by the async generator
    // The fix ensures that all buffered chunks are yielded after the finished flag is set.

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(
          JSON.stringify({
            success: true,
            bytesReceived: text.length,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const dashes = Buffer.alloc(100, "-").toString();
    const clientScript = `
const http = require('http');

const chunks = [];
for (let i = 0; i < 100; i++) {
  chunks.push('chunk' + i.toString().padStart(3, '0') + '${dashes}');
}
const expectedContent = chunks.join('');

const req = http.request('http://localhost:${server.port}/', {
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked',
  },
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (result.bytesReceived !== expectedContent.length) {
        console.error('Length mismatch! Expected:', expectedContent.length, 'Got:', result.bytesReceived);
        process.exit(1);
      }
      console.log(JSON.stringify(result));
    } catch (e) {
      console.error('Failed to parse response:', e.message);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

// Write chunks quickly to simulate fast data piping
for (const chunk of chunks) {
  req.write(chunk);
}
req.end();
`;

    // Run the client with inline script
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", clientScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (stderr) {
      console.error("stderr:", stderr);
    }

    // Check stdout before exitCode for better error messages on test failure
    expect(stdout.trim()).not.toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.success).toBe(true);
    // 100 chunks, each is "chunkXXX" + 100 dashes = 8 + 100 = 108 chars
    expect(result.bytesReceived).toBe(100 * 108);
    expect(exitCode).toBe(0);
  });

  // This test requires a longer timeout because it installs npm packages (request, request-promise)
  test("request-promise with form-data and fs.createReadStream works correctly", { timeout: 60_000 }, async () => {
    // This test specifically reproduces the original issue:
    // Using request-promise with form-data piping an fs.createReadStream

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          const formData = await req.formData();
          const file = formData.get("sourceFile");
          if (!(file instanceof Blob)) {
            return new Response(JSON.stringify({ success: false, error: "No file found" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const content = await file.arrayBuffer();
          return new Response(
            JSON.stringify({
              success: true,
              bytesReceived: file.size,
              // Verify content is correct (should be all 'A's)
              contentValid: new Uint8Array(content).every(b => b === 65), // 65 is 'A'
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e: unknown) {
          let errorMessage: string;
          if (e instanceof Error) {
            errorMessage = e.message;
          } else if (typeof e === "object" && e !== null && "message" in e) {
            errorMessage = String((e as { message: unknown }).message);
          } else {
            errorMessage = String(e);
          }
          return new Response(JSON.stringify({ success: false, error: errorMessage }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    });

    using dir = tempDir("test-26638-form", {
      "package.json": JSON.stringify({
        name: "test-26638",
        dependencies: {
          request: "^2.88.2",
          "request-promise": "^4.2.6",
        },
      }),
      // Create a test file with known content (100KB)
      "testfile.txt": Buffer.alloc(1024 * 100, "A").toString(),
      "client.js": `
const fs = require('fs');
const request = require('request-promise');

async function upload() {
  try {
    const result = await request.post('http://localhost:${server.port}/', {
      formData: {
        sourceFile: fs.createReadStream('./testfile.txt'),
      },
      json: true,
    });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error('Error:', e.statusCode, e.error?.error || e.message);
    process.exit(1);
  }
}

upload();
`,
    });

    // Install dependencies
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [installStdout, installStderr, installExitCode] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);
    if (installExitCode !== 0) {
      console.error("Install stdout:", installStdout);
      console.error("Install stderr:", installStderr);
    }
    expect(installExitCode).toBe(0);

    // Run the client
    await using proc = Bun.spawn({
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

    // Check stdout before exitCode for better error messages on test failure
    expect(stdout.trim()).not.toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.success).toBe(true);
    expect(result.bytesReceived).toBe(1024 * 100);
    expect(result.contentValid).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("multiple rapid writes followed by immediate end() yields all data", async () => {
    // This test ensures that when many writes happen in quick succession
    // followed by an immediate end(), no data is lost.

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const text = await req.text();
        return new Response(
          JSON.stringify({
            success: true,
            bytesReceived: text.length,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const chunkContent = Buffer.alloc(100, "X").toString();
    const clientScript = `
const http = require('http');

const numChunks = 1000;
const chunkSize = 100;
const expectedLength = numChunks * chunkSize;

const req = http.request('http://localhost:${server.port}/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/octet-stream',
    'Transfer-Encoding': 'chunked',
  },
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const result = JSON.parse(data);
    if (result.bytesReceived !== expectedLength) {
      console.error('FAIL: Expected', expectedLength, 'bytes, got', result.bytesReceived);
      process.exit(1);
    }
    console.log(JSON.stringify(result));
  });
});

// Write many chunks as fast as possible
const chunk = '${chunkContent}';
for (let i = 0; i < numChunks; i++) {
  req.write(chunk);
}
// End immediately after all writes
req.end();
`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", clientScript],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (stderr) {
      console.error("stderr:", stderr);
    }

    // Check stdout before exitCode for better error messages on test failure
    expect(stdout.trim()).not.toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result.success).toBe(true);
    expect(result.bytesReceived).toBe(1000 * 100); // 1000 chunks * 100 bytes
    expect(exitCode).toBe(0);
  });
});
