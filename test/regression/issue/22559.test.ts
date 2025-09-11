import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import net from "net";
import { createServer as createHTTPServer } from "http";

test("systemd socket activation with net.createServer (issue #22559)", async () => {
  // Create a listening socket that we'll pass as fd 3
  const listenerServer = net.createServer();
  await new Promise((resolve) => {
    listenerServer.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  
  const { port } = listenerServer.address() as net.AddressInfo;
  
  // Create a test script that listens on fd 3
  using dir = tempDir("systemd-test", {
    "server.js": `
      const net = require("net");
      
      // Simulate systemd socket activation - listen on fd 3
      const server = net.createServer((socket) => {
        socket.write("Hello from systemd activated server\\n");
        socket.end();
      });
      
      server.listen({ fd: 3 }, () => {
        console.log("Server listening on fd 3");
      });
      
      // Keep the server running for the test
      setTimeout(() => {}, 5000);
    `,
  });

  // Start the child process with the socket on fd 3
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: {
      ...bunEnv,
      LISTEN_PID: "$$", // Current process PID
      LISTEN_FDS: "1",  // One socket being passed
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    // Pass the listening socket as fd 3
    stdio: ["inherit", "inherit", "inherit", listenerServer._handle.fd],
  });

  // Wait for the server to start
  await Bun.sleep(100);

  // Test connecting to the server
  const client = net.createConnection(port, "127.0.0.1");
  
  const response = await new Promise<string>((resolve, reject) => {
    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
    });
    client.on("end", () => {
      resolve(data);
    });
    client.on("error", reject);
  });

  expect(response).toBe("Hello from systemd activated server\n");
  
  // Clean up
  listenerServer.close();
  proc.kill();
});

test("systemd socket activation with http.createServer", async () => {
  // Create a listening socket that we'll pass as fd 3
  const listenerServer = net.createServer();
  await new Promise((resolve) => {
    listenerServer.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  
  const { port } = listenerServer.address() as net.AddressInfo;
  
  // Create a test script that uses http server with fd
  using dir = tempDir("systemd-http-test", {
    "server.js": `
      const http = require("http");
      
      // Simulate systemd socket activation - listen on fd 3
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("Hello from systemd HTTP server");
      });
      
      server.listen({ fd: 3 }, () => {
        console.log("HTTP server listening on fd 3");
      });
      
      // Keep the server running for the test
      setTimeout(() => {}, 5000);
    `,
  });

  // Start the child process with the socket on fd 3
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: {
      ...bunEnv,
      LISTEN_PID: "$$",
      LISTEN_FDS: "1",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    stdio: ["inherit", "inherit", "inherit", listenerServer._handle.fd],
  });

  // Wait for the server to start
  await Bun.sleep(100);

  // Test HTTP request
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const text = await response.text();
  
  expect(text).toBe("Hello from systemd HTTP server");
  
  // Clean up
  listenerServer.close();
  proc.kill();
});

test("Bun.serve with file descriptor", async () => {
  // Create a listening socket that we'll pass as fd 3
  const listenerServer = net.createServer();
  await new Promise((resolve) => {
    listenerServer.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  
  const { port } = listenerServer.address() as net.AddressInfo;
  
  // Create a test script that uses Bun.serve with fd
  using dir = tempDir("bun-serve-fd-test", {
    "server.js": `
      Bun.serve({
        fd: 3,
        fetch(req) {
          return new Response("Hello from Bun.serve with fd");
        },
      });
      
      console.log("Bun.serve listening on fd 3");
      
      // Keep the server running for the test
      setTimeout(() => {}, 5000);
    `,
  });

  // Start the child process with the socket on fd 3
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: {
      ...bunEnv,
      LISTEN_PID: "$$",
      LISTEN_FDS: "1",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
    stdio: ["inherit", "inherit", "inherit", listenerServer._handle.fd],
  });

  // Wait for the server to start
  await Bun.sleep(100);

  // Test HTTP request
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const text = await response.text();
  
  expect(text).toBe("Hello from Bun.serve with fd");
  
  // Clean up
  listenerServer.close();
  proc.kill();
});