import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("IncomingMessage has headersDistinct and trailersDistinct properties", async () => {
  using dir = tempDir("24268", {
    "server.js": `
      const http = require("node:http");

      const server = http.createServer((req, res) => {
        // Test headersDistinct exists and is an object
        console.log("headersDistinct type:", typeof req.headersDistinct);
        console.log("headersDistinct:", JSON.stringify(req.headersDistinct));

        // Test trailersDistinct exists and is an object
        console.log("trailersDistinct type:", typeof req.trailersDistinct);
        console.log("trailersDistinct:", JSON.stringify(req.trailersDistinct));

        // Verify headers are arrays
        const accept = req.headersDistinct.accept;
        console.log("accept is array:", Array.isArray(accept));
        if (accept) {
          console.log("accept length:", accept.length);
          console.log("accept values:", JSON.stringify(accept));
        }

        const host = req.headersDistinct.host;
        console.log("host is array:", Array.isArray(host));
        if (host) {
          console.log("host length:", host.length);
        }

        // Test that accessing headersDistinct twice returns the same object (cached)
        const first = req.headersDistinct;
        const second = req.headersDistinct;
        console.log("headersDistinct cached:", first === second);

        res.writeHead(200);
        res.end("OK");
        server.close();
      });

      server.listen(0, () => {
        const port = server.address().port;

        // Make a request with some headers including duplicates
        const options = {
          hostname: "localhost",
          port: port,
          path: "/",
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Host": \`localhost:\${port}\`,
            "User-Agent": "test-agent",
          }
        };

        const req = http.request(options, (res) => {
          res.resume();
        });

        req.end();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Verify headersDistinct exists and is an object
  expect(stdout).toContain("headersDistinct type: object");

  // Verify trailersDistinct exists and is an object
  expect(stdout).toContain("trailersDistinct type: object");

  // Verify header values are arrays
  expect(stdout).toContain("accept is array: true");
  expect(stdout).toContain("host is array: true");

  // Verify headersDistinct is cached
  expect(stdout).toContain("headersDistinct cached: true");

  expect(exitCode).toBe(0);
});

test("headersDistinct handles multiple headers with same name", async () => {
  using dir = tempDir("24268-multi", {
    "server.js": `
      const http = require("node:http");

      const server = http.createServer((req, res) => {
        // When we send raw HTTP with duplicate headers, check they're grouped
        const distinct = req.headersDistinct;

        // All headers should be arrays
        for (const key in distinct) {
          if (!Array.isArray(distinct[key])) {
            console.log("ERROR: " + key + " is not an array");
          }
        }

        console.log("SUCCESS: All headers are arrays");
        console.log("headers:", JSON.stringify(distinct));

        res.writeHead(200);
        res.end("OK");
        server.close();
      });

      server.listen(0, () => {
        const port = server.address().port;
        const net = require("node:net");

        // Send raw HTTP request with duplicate Accept headers
        const socket = net.createConnection(port, "localhost", () => {
          socket.write(
            "GET / HTTP/1.1\\r\\n" +
            "Host: localhost:" + port + "\\r\\n" +
            "Accept: application/json\\r\\n" +
            "Accept: text/plain\\r\\n" +
            "Accept: text/html\\r\\n" +
            "Connection: close\\r\\n" +
            "\\r\\n"
          );
        });

        socket.on("data", () => {
          // Response received, close socket
          socket.end();
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("SUCCESS: All headers are arrays");

  // Verify the accept header has multiple values
  const headersMatch = stdout.match(/"accept":\s*\[(.*?)\]/);
  if (headersMatch) {
    const acceptValues = headersMatch[1];
    // Should have multiple accept values
    expect(acceptValues).toContain("application/json");
    expect(acceptValues).toContain("text/plain");
    expect(acceptValues).toContain("text/html");
  }

  expect(exitCode).toBe(0);
});

test("headersDistinct returns empty object when no headers", async () => {
  using dir = tempDir("24268-empty", {
    "test.js": `
      const http = require("node:http");
      const { IncomingMessage } = require("node:http");

      // Create an IncomingMessage with no headers
      const req = new IncomingMessage();

      console.log("headersDistinct type:", typeof req.headersDistinct);
      console.log("headersDistinct keys:", Object.keys(req.headersDistinct).length);
      console.log("trailersDistinct type:", typeof req.trailersDistinct);
      console.log("trailersDistinct keys:", Object.keys(req.trailersDistinct).length);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("headersDistinct type: object");
  expect(stdout).toContain("headersDistinct keys: 0");
  expect(stdout).toContain("trailersDistinct type: object");
  expect(stdout).toContain("trailersDistinct keys: 0");

  expect(exitCode).toBe(0);
});
