// Test for GitHub issue #24682: node:http server cannot listen on Windows named pipes
// https://github.com/oven-sh/bun/issues/24682

import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

describe.skipIf(!isWindows)("node:http Windows named pipe support", () => {
  test("http server can listen and respond on Windows named pipe", async () => {
    // Use a unique pipe name based on process ID and timestamp to avoid conflicts
    const pipeName = `\\\\.\\pipe\\bun-test-${process.pid}-${Date.now()}`;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const http = require("node:http");
const net = require("node:net");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello from named pipe!");
});

server.listen("${pipeName.replace(/\\/g, "\\\\")}", () => {
  console.log("Server listening on pipe");

  // Use net.connect to make a raw HTTP request to the named pipe
  const client = net.connect("${pipeName.replace(/\\/g, "\\\\")}", () => {
    console.log("Client connected");
    client.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n");
  });

  let response = "";
  client.on("data", (data) => {
    response += data.toString();
  });

  client.on("close", () => {
    console.log("Got response");
    if (response.includes("Hello from named pipe!")) {
      console.log("Response contains expected body");
    }
    if (response.includes("HTTP/1.1 200")) {
      console.log("Got HTTP 200 response");
    }
    // Force exit after receiving response - close callback has known issues
    process.exit(0);
  });

  client.on("error", (err) => {
    console.error("Client error:", err.message);
    process.exit(1);
  });
});

server.on("error", (err) => {
  console.error("Server error:", err.message);
  process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error("Timeout");
  process.exit(1);
}, 10000);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(stdout).toContain("Server listening on pipe");
    expect(stdout).toContain("Client connected");
    expect(stdout).toContain("Response contains expected body");
    expect(stdout).toContain("Got HTTP 200 response");
    expect(exitCode).toBe(0);
  });

  test("http server emits listening event on named pipe", async () => {
    const pipeName = `\\\\.\\pipe\\bun-test-listening-${process.pid}-${Date.now()}`;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const http = require("node:http");

const server = http.createServer();

server.on("listening", () => {
  const addr = server.address();
  console.log("Listening event fired");
  console.log("Address type:", typeof addr);
  // Force exit - close callback has known issues
  process.exit(0);
});

server.on("error", (err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

server.listen("${pipeName.replace(/\\/g, "\\\\")}");

setTimeout(() => {
  console.error("Timeout");
  process.exit(1);
}, 5000);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(stdout).toContain("Listening event fired");
    expect(exitCode).toBe(0);
  });

  test("http server callback fires on named pipe listen", async () => {
    const pipeName = `\\\\.\\pipe\\bun-test-callback-${process.pid}-${Date.now()}`;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const http = require("node:http");

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});

server.listen("${pipeName.replace(/\\/g, "\\\\")}", () => {
  console.log("Callback fired");
  // Force exit - close callback has known issues
  process.exit(0);
});

server.on("error", (err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("Timeout");
  process.exit(1);
}, 5000);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
    }

    expect(stdout).toContain("Callback fired");
    expect(exitCode).toBe(0);
  });
});
