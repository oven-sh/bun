import { test, expect } from "bun:test";
import net from "net";
import { bunEnv, bunExe } from "harness";

test("file descriptor listening support (issue #22559)", async () => {
  // This test verifies that Bun no longer rejects listening on file descriptors
  // Previously, it would throw "Bun does not support listening on a file descriptor"
  
  const server = net.createServer();
  
  // This should not throw the "does not support" error anymore
  // It will fail with EBADF because fd 3 doesn't exist, but that's expected
  let errorCaught = false;
  let errorMessage = "";
  
  server.on("error", (err) => {
    errorCaught = true;
    errorMessage = err.message;
  });
  
  server.listen({ fd: 3 });
  
  // Wait a bit for the error to be caught
  await Bun.sleep(10);
  
  expect(errorCaught).toBe(true);
  expect(errorMessage).not.toContain("does not support listening on a file descriptor");
  
  server.close();
});

test("Bun.listen with fd parameter", async () => {
  // Test that Bun.listen also accepts fd parameter
  let errorCaught = false;
  let errorMessage = "";
  
  try {
    const listener = Bun.listen({
      fd: 3,
      socket: {
        data: {},
        open(socket) {},
        close(socket) {},
        drain(socket) {},
      },
    });
    
    // If we get here, it means fd listening is supported
    // Close the listener if it was created
    if (listener) {
      listener.stop();
    }
  } catch (err: any) {
    errorCaught = true;
    errorMessage = err.message || err.toString();
  }
  
  // We expect an error because fd 3 doesn't exist, but not the "does not support" error
  if (errorCaught) {
    expect(errorMessage).not.toContain("does not support listening on a file descriptor");
  }
});

test("systemd-socket-activate command simulation", async () => {
  // This test simulates what systemd-socket-activate does
  // It creates a script that listens on fd 3 when LISTEN_FDS is set
  
  const testScript = `
    const net = require("net");
    
    // Check for systemd socket activation environment variables
    const listenPid = process.env.LISTEN_PID;
    const listenFds = process.env.LISTEN_FDS;
    
    if (listenFds === "1") {
      // systemd socket activation mode - listen on fd 3
      const server = net.createServer((socket) => {
        socket.write("systemd-activated");
        socket.end();
      });
      
      server.listen({ fd: 3 }, () => {
        console.log("LISTENING_ON_FD_3");
      });
      
      server.on("error", (err) => {
        console.error("ERROR:", err.message);
        process.exit(1);
      });
    } else {
      console.log("NO_SYSTEMD_ACTIVATION");
      process.exit(0);
    }
  `;
  
  // Test with LISTEN_FDS set
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", testScript],
    env: {
      ...bunEnv,
      LISTEN_PID: "12345",
      LISTEN_FDS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const output = await proc.stdout.text();
  
  // The important thing is that it doesn't fail with "does not support listening on a file descriptor"
  // It should either work or fail with a different error (like EBADF)
  expect(output).toContain("LISTENING_ON_FD_3");
});