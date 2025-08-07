import { expect, test } from "bun:test";
import { nodeExe, tempDirWithFiles } from "harness";
import net from "node:net";

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
