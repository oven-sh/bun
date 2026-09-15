import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, nodeExe, tempDir, tempDirWithFiles } from "harness";
import net from "node:net";
import { join } from "node:path";

async function nodeRun(callback, clients = 1) {
  const cwd = tempDirWithFiles("server", {
    "index.mjs": `
  import net from "node:net";
  let clients = ${clients};
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    // Listen for data from the client
    socket.on("data", data => {
      console.log(data.toString());
    });

    socket.on("end", () => {
      console.log("Received FIN");
      if(--clients == 0) {
        server.close();
      }
    });
    socket.on("error", console.error);

    // start sending FIN
    socket.end();
  });
  server.listen(0, "127.0.0.1", ()=> {
    console.log(server.address().port?.toString());
  })
  `,
  });
  const process = Bun.spawn([nodeExe(), "index.mjs"], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = process.stdout.getReader();
  let continueReading = true;
  let stdout = "";
  let port = 0;
  do {
    const { done, value } = await reader.read();

    continueReading = !done;
    const decoder = new TextDecoder();
    if (value) {
      if (!port) {
        port = parseInt(decoder.decode(value), 10);
        callback(port);
      } else {
        stdout += decoder.decode(value);
      }
    }
  } while (continueReading);

  return {
    stdout,
    stderr: (await process.stderr.text()).trim(),
    code: await process.exited,
  };
}

async function doHalfOpenRequest(port, allowHalfOpen) {
  const { promise, resolve, reject } = Promise.withResolvers();

  const client = net.connect({ host: "127.0.0.1", port, allowHalfOpen }, () => {
    client.write("Hello, World");
  });
  client.on("error", reject);
  client.on("close", resolve);
  client.on("end", () => {
    // delay the write response
    setTimeout(() => {
      client.write("Write after end");
      client.end();
    }, 10);
  });
  await promise;
}

test("allowHalfOpen: true should work on client-side", async () => {
  const { promise: portPromise, resolve } = Promise.withResolvers();
  const process = nodeRun(resolve, 1);

  const port = await portPromise;
  await doHalfOpenRequest(port, true);
  const result = await process;
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout
      .split("\n")
      .map(s => s.trim())
      .filter(s => s),
  ).toEqual(["Hello, World", "Write after end", "Received FIN"]);
});

test("allowHalfOpen: false should work on client-side", async () => {
  const { promise: portPromise, resolve } = Promise.withResolvers();
  const process = nodeRun(resolve, 1);

  const port = await portPromise;
  await doHalfOpenRequest(port, false);
  const result = await process;
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(
    result.stdout
      .split("\n")
      .map(s => s.trim())
      .filter(s => s),
  ).toEqual(["Hello, World", "Received FIN"]);
});

// Regression test for #39723: over a Windows named pipe, client.end() closed the whole
// pipe handle instead of half-closing the write side, so the server's reply to the
// final write never reached the client (test-net-pingpong, 1000 !== 1001).
// Runs the same ping-pong over a unix socket elsewhere.
test("allowHalfOpen: reply to the final write before end() is still delivered (pipe transport)", async () => {
  using dir = tempDir("net-pipe-pingpong", {
    "pingpong-fixture.js": `
      const net = require("net");
      const path = require("path");
      const N = 3;
      const PIPE =
        process.platform === "win32"
          ? "\\\\\\\\.\\\\pipe\\\\bun-halfopen-pingpong-" + process.pid
          : path.join(__dirname, "pingpong.sock");
      let count = 0;
      let sentFinalPing = false;
      const server = net.createServer({ allowHalfOpen: true }, socket => {
        socket.setEncoding("utf8");
        socket.on("data", data => {
          if (data !== "PING") {
            console.error("server got " + JSON.stringify(data));
            process.exit(1);
          }
          socket.write("PONG");
        });
        socket.on("end", () => socket.end());
        socket.on("close", () => server.close());
      });
      server.listen(PIPE, () => {
        const client = net.createConnection(PIPE);
        client.setEncoding("utf8");
        client.on("connect", () => client.write("PING"));
        client.on("data", data => {
          if (data !== "PONG") {
            console.error("client got " + JSON.stringify(data));
            process.exit(1);
          }
          count++;
          if (sentFinalPing) return;
          if (count < N) {
            client.write("PING");
          } else {
            sentFinalPing = true;
            client.write("PING");
            client.end();
          }
        });
        client.on("close", () => {
          console.log("count = " + count + " expected " + (N + 1));
          process.exit(count === N + 1 ? 0 : 1);
        });
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pingpong-fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("count = 4 expected 4\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// A paused allowHalfOpen socket whose AF_UNIX peer writes a tail and closes (EPOLLHUP while paused) must keep
// the tail for resume() and then deliver data, end and close once each; the paused window must not spin the loop.
test.skipIf(isWindows)("allowHalfOpen: paused socket whose unix peer closed delivers its tail on resume", async () => {
  using dir = tempDir("net-paused-unix-hangup", {});
  const result = await bunRun(join(import.meta.dir, "node-net-paused-unix-hangup-fixture.js"), {
    SOCK: join(String(dir), "p.sock"),
  });
  const expected = Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [`tail-${i}`, { data: `tail-${i}\n`, ends: 1, closes: 1 }]),
  );
  expect(result).toEqual({ stdout: JSON.stringify(expected) + "\nidle", stderr: "", exitCode: 0, signalCode: null });
});
