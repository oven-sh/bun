import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("server shutdown does not crash with SIGINT", async () => {
  const dir = tempDirWithFiles("server-shutdown-test", {
    "server.js": `
      let server;

      const gracefulShutdown = (signal) => {
        console.log(\`Received \${signal}, shutting down gracefully...\`);
        
        if (server) {
          server.stop();
        }
        
        setTimeout(() => {
          console.log("Graceful shutdown complete");
          process.exit(0);
        }, 10);
      };

      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);

      server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Hello World!");
        },
        error(error) {
          console.error("Server error:", error);
          return new Response("Server Error", { status: 500 });
        }
      });

      console.log(\`Server running on port \${server.port}\`);

      // Auto-shutdown after 1 second (this should trigger before timeout)
      setTimeout(() => {
        gracefulShutdown('TIMEOUT');
      }, 1000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill("SIGKILL");
  }, 5000); // 5s timeout

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timeout);

  // Should exit cleanly without segfault
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Server running on port");
  expect(stdout).toContain("Received TIMEOUT, shutting down gracefully");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
}, 8000);

test("server shutdown does not crash with SIGTERM", async () => {
  const dir = tempDirWithFiles("server-shutdown-test-term", {
    "server.js": `
      let server;
      let cleanup = () => {};

      const gracefulShutdown = (signal) => {
        console.log(\`Received \${signal}, shutting down gracefully...\`);
        
        if (server) {
          server.stop();
        }
        
        cleanup();
        process.exit(0);
      };

      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);

      server = Bun.serve({
        port: 0,
        fetch() {
          return new Response("Hello World!");
        },
        error(error) {
          console.error("Server error:", error);
          return new Response("Server Error", { status: 500 });
        }
      });

      console.log(\`Server running on port \${server.port}\`);

      // Simulate some work and then send SIGTERM after a short delay
      setTimeout(() => {
        process.kill(process.pid, 'SIGTERM');
      }, 100);

      // Keep the process alive until signal is received
      setInterval(() => {}, 1000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, 5000); // 5s timeout

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timeout);

  // Should exit cleanly without segfault
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Server running on port");
  expect(stdout).toContain("Received SIGTERM, shutting down gracefully");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
}, 10000);

test("server shutdown with active connections does not crash", async () => {
  const dir = tempDirWithFiles("server-shutdown-connections-test", {
    "server.js": `
      let server;
      let activeConnections = new Set();
      
      const gracefulShutdown = (signal) => {
        console.log(\`Received \${signal}, shutting down gracefully...\`);
        console.log(\`Active connections: \${activeConnections.size}\`);
        
        // Close active connections
        for (const conn of activeConnections) {
          try {
            conn.close();
          } catch (e) {
            // ignore
          }
        }
        activeConnections.clear();
        
        if (server) {
          server.stop();
        }
        
        process.exit(0);
      };

      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);

      server = Bun.serve({
        port: 0,
        async fetch(req) {
          // Simulate some async work
          await new Promise(resolve => setTimeout(resolve, 50));
          return new Response("Hello World!");
        },
        error(error) {
          console.error("Server error:", error);
          return new Response("Server Error", { status: 500 });
        }
      });

      console.log(\`Server running on port \${server.port}\`);

      // Make some requests and then shutdown
      setTimeout(async () => {
        try {
          // Make multiple concurrent requests
          const promises = [];
          for (let i = 0; i < 3; i++) {
            promises.push(fetch(\`http://localhost:\${server.port}\`));
          }
          
          // Start requests but don't wait for them to complete
          Promise.all(promises).catch(() => {});
          
          // Send shutdown signal while requests are in flight
          setTimeout(() => {
            process.kill(process.pid, 'SIGINT');
          }, 25);
        } catch (e) {
          console.error("Request error:", e);
        }
      }, 100);

      // Keep the process alive until signal is received
      setInterval(() => {}, 1000);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, 5000); // 5s timeout

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timeout);

  // Should exit cleanly without segfault
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Server running on port");
  expect(stdout).toContain("Received SIGINT, shutting down gracefully");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
}, 10000);
