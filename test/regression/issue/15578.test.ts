import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/15578
// Node.js HTTP server should preserve the original casing of header names
// when using res.setHeader()

test("res.setHeader preserves original header name casing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { createServer } from 'node:http';
      import { connect } from 'node:net';

      const http = createServer((req, res) => {
        res.setHeader('location', 'http://test.com');
        res.setHeader('content-type', 'text/plain');
        res.setHeader('X-Custom-Header', 'custom-value');
        res.setHeader('X-UPPERCASE', 'value1');
        res.setHeader('x-lowercase', 'value2');
        res.end('test');
      });

      http.listen(0, () => {
        const port = http.address().port;

        // Use raw socket to see actual header casing
        const client = connect(port, 'localhost', () => {
          client.write('GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n');
        });

        client.on('data', (data) => {
          const response = data.toString();
          console.log(response);
          client.end();
          http.close();
        });
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Check that lowercase headers are preserved as lowercase
  expect(stdout).toContain("location: http://test.com");
  expect(stdout).toContain("content-type: text/plain");

  // Check that the original casing is preserved
  expect(stdout).toContain("X-Custom-Header: custom-value");
  expect(stdout).toContain("X-UPPERCASE: value1");
  expect(stdout).toContain("x-lowercase: value2");

  // Make sure title-case versions are NOT present
  expect(stdout).not.toContain("Location:");
  expect(stdout).not.toContain("Content-Type:");
});

test("res.setHeader with array values preserves header name casing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { createServer } from 'node:http';
      import { connect } from 'node:net';

      const http = createServer((req, res) => {
        // Set a header with multiple values (array)
        res.setHeader('x-multi-value', ['value1', 'value2']);
        res.end('test');
      });

      http.listen(0, () => {
        const port = http.address().port;

        const client = connect(port, 'localhost', () => {
          client.write('GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n');
        });

        client.on('data', (data) => {
          const response = data.toString();
          console.log(response);
          client.end();
          http.close();
        });
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // x-multi-value should appear with original lowercase casing
  expect(stdout).toContain("x-multi-value:");
});

test("writeHead preserves header name casing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { createServer } from 'node:http';
      import { connect } from 'node:net';

      const http = createServer((req, res) => {
        res.writeHead(302, {
          'location': '/redirect',
          'cache-control': 'no-cache'
        });
        res.end();
      });

      http.listen(0, () => {
        const port = http.address().port;

        const client = connect(port, 'localhost', () => {
          client.write('GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n');
        });

        client.on('data', (data) => {
          const response = data.toString();
          console.log(response);
          client.end();
          http.close();
        });
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // Headers passed to writeHead should preserve their casing
  expect(stdout).toContain("location: /redirect");
  expect(stdout).toContain("cache-control: no-cache");
});
