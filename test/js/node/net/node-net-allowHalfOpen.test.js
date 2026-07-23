import { describe, expect, test } from "bun:test";
import { nodeExe, tempDirWithFiles, tmpdirSync } from "harness";
import { once } from "node:events";
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

// Replies on the tick after the peer's FIN, which only lands if the accepted
// socket really stayed half-open: a listener that auto-closes on EOF has already
// torn the socket down by the time the `end` listener's setImmediate runs.
function replyAfterFin(reply) {
  return conn => conn.on("end", () => setImmediate(() => conn.end(reply)));
}

function halfCloseThenRead(options) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const client = net.connect(options);
  let received = "";
  client.on("connect", () => client.end());
  client.on("data", chunk => (received += chunk));
  client.on("close", () => resolve(received));
  client.on("error", reject);
  return promise;
}

describe("allowHalfOpen: true on the server side", () => {
  test.each([
    ["tcp", () => ({ port: 0, host: "127.0.0.1" })],
    ["unix", () => ({ path: join(tmpdirSync(), "half-open.sock") })],
  ])("keeps an accepted %s socket writable after the peer's FIN", async (_name, makeListenOptions) => {
    const server = net.createServer({ allowHalfOpen: true }, replyAfterFin("REPLY-AFTER-FIN"));
    server.listen(makeListenOptions());
    await once(server, "listening");

    try {
      const address = server.address();
      const connectOptions =
        typeof address === "string" ? { path: address } : { port: address.port, host: address.address };
      expect(await halfCloseThenRead(connectOptions)).toBe("REPLY-AFTER-FIN");
    } finally {
      server.close();
    }
  });
});
