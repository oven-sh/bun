// A response that waits behind another one on its connection (res.socket === null) records what
// it is given, and the record goes out when the response has the connection.
//
// usage: <memory|handover>
// Prints one JSON line per scenario.
//
// "memory": each scenario changes the storage of a buffer chunk between the call and the bytes on
// the wire. The record and the write must not read storage that JS freed or moved. A sanitizer
// build stops at the first such read.
// "handover": a listener throws while the response gets the connection. The exception is an
// uncaught one of the process, and the connection still serves that response and the next.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { duplexPair } from "node:stream";

const suite = process.argv[2];
const size = 4096;
const requests = (queued: boolean) =>
  (queued ? "GET /first HTTP/1.1\r\nHost: x\r\n\r\n" : "") +
  "GET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";

// Other allocations that can take the place of freed storage.
const junk: Buffer[] = [];
function reuseFreedStorage() {
  for (let i = 0; i < 64; i++) junk.push(Buffer.alloc(size, "b"));
}

type Scenario = {
  queued: boolean;
  // Answers the second request. The first response ends after it.
  listener: (res: http.ServerResponse) => void;
  // The client does not read until the server has given the connection to the second response.
  pausedClient?: boolean;
};

// What the client got for the second request: the head, and what the body is made of.
async function run(name: string, { queued, listener, pausedClient }: Scenario) {
  let first: http.ServerResponse | undefined;
  const answered = Promise.withResolvers<void>();
  const server = http.createServer((req, res) => {
    if (req.url === "/first") return void (first = res);
    listener(res);
    if (pausedClient) res.on("socket", () => setImmediate(answered.resolve));
    first?.end("first");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  const chunks: Buffer[] = [];
  client.on("data", chunk => chunks.push(chunk));
  if (pausedClient) client.pause();
  client.write(requests(queued));
  if (pausedClient) {
    await answered.promise;
    Bun.gc(true);
    reuseFreedStorage();
    client.resume();
  }
  await once(client, "close");
  server.close();
  const wire = Buffer.concat(chunks).toString("latin1");
  const second = queued ? wire.slice(wire.indexOf("\r\n\r\nfirst") + 9) : wire;
  const headEnd = second.indexOf("\r\n\r\n");
  const body = second.slice(headEnd + 4);
  console.log(
    JSON.stringify({
      name,
      head: second.slice(0, headEnd).replace(/Date: [^\r]+\r\n/g, ""),
      bodyLength: body.length,
      // Only the bytes that the chunk had when the call was made.
      onlyA: /^a*$/.test(body),
    }),
  );
}

async function memory() {
  // A typed array of more than 1000 elements has no ArrayBuffer of its own until JS reads its
  // `buffer`. A transfer of that buffer frees the storage.
  await run("queued write(), then the buffer is transferred away", {
    queued: true,
    listener(res) {
      const chunk = new Uint8Array(size).fill(0x61);
      res.write(chunk);
      chunk.buffer.transfer(8);
      reuseFreedStorage();
      res.end();
    },
  });

  // grow() detaches the buffer of a WebAssembly.Memory and can move its storage.
  await run("queued write() of WebAssembly memory, then the memory grows", {
    queued: true,
    listener(res) {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2000 });
      res.write(new Uint8Array(memory.buffer, 0, size).fill(0x61));
      memory.grow(600);
      new Uint8Array(memory.buffer).fill(0x62, 0, 65536);
      reuseFreedStorage();
      res.end();
    },
  });

  await run("queued end(), then the resizable buffer shrinks to nothing", {
    queued: true,
    listener(res) {
      const buffer = new ArrayBuffer(size, { maxByteLength: size });
      res.end(new Uint8Array(buffer).fill(0x61));
      buffer.resize(0);
    },
  });

  // Nothing but the record holds the chunk.
  await run("queued write(), then a collection", {
    queued: true,
    listener(res) {
      res.setHeader("Content-Length", 4 * size);
      res.write(Buffer.alloc(size, "a"));
      res.write(new DataView(new Uint8Array(size).fill(0x61).buffer));
      res.write(new Uint8Array(size).fill(0x61).buffer);
      res.end(new Uint8Array(size).fill(0x61));
      Bun.gc(true);
      reuseFreedStorage();
    },
  });

  // More than the socket takes at once: the connection holds the rest of the chunk by reference.
  await run("queued write() of 8 MB to a client that does not read", {
    queued: true,
    pausedClient: true,
    listener(res) {
      res.setHeader("Content-Length", 8 * 1024 * 1024 + size);
      res.write(Buffer.alloc(8 * 1024 * 1024, "a"));
      res.end(Buffer.alloc(size, "a"));
    },
  });

  // The bytes of a buffer chunk are borrowed from the conversion of the chunk to the write, so
  // no JS may run in between. The toString() of a statusMessage that is not a string is JS.
  for (const [method, queued] of [
    ["end", false],
    ["end", true],
    ["write", false],
  ] as const) {
    await run(`${queued ? "queued" : "current"} ${method}(): the statusMessage shrinks the buffer of the chunk`, {
      queued,
      listener(res) {
        const buffer = new ArrayBuffer(size, { maxByteLength: size });
        const chunk = new Uint8Array(buffer).fill(0x61);
        res.statusMessage = {
          toString() {
            buffer.resize(0);
            return "OK";
          },
        } as any;
        if (method === "end") res.end(chunk);
        else {
          res.write(chunk);
          res.end();
        }
      },
    });
  }

  // So is the toString() of what a replaced join() of a header value returns.
  for (const method of ["end", "write"] as const) {
    await run(`current ${method}(): a header value shrinks the buffer of the chunk`, {
      queued: false,
      listener(res) {
        const buffer = new ArrayBuffer(size, { maxByteLength: size });
        const chunk = new Uint8Array(buffer).fill(0x61);
        const cookies = ["a=1", "b=2"];
        res.setHeader("Cookie", cookies);
        cookies.join = () =>
          ({
            toString() {
              buffer.resize(0);
              return "a=1; b=2";
            },
          }) as any;
        if (method === "end") res.end(chunk);
        else {
          res.write(chunk);
          res.end();
        }
      },
    });
  }
}

// Three requests on one connection. The first response ends after the listener of the second
// request ran, so the second response is queued. The client sends the third request when it has
// the whole second response.
async function handover(name: string, transport: string, listener: (res: http.ServerResponse) => void) {
  const uncaught: string[] = [];
  const onUncaught = (error: Error) => void uncaught.push(error.message);
  process.on("uncaughtException", onUncaught);
  const events: string[] = [];
  let first: http.ServerResponse | undefined;
  const server = http.createServer((req, res) => {
    if (req.url === "/first") return void (first = res);
    if (req.url === "/third") return void res.end("third");
    res.on("finish", () => events.push("finish"));
    listener(res);
    first!.end("first");
  });
  let client: net.Socket | ReturnType<typeof duplexPair>[0];
  if (transport === "tcp") {
    await once(server.listen(0, "127.0.0.1"), "listening");
    client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  } else {
    const [clientSide, serverSide] = duplexPair();
    server.emit("connection", serverSide);
    client = clientSide;
  }
  let wire = "";
  let sentThird = false;
  const done = Promise.withResolvers<void>();
  client.on("data", chunk => {
    wire += chunk.toString("latin1");
    if (!sentThird && wire.endsWith("second")) {
      sentThird = true;
      client.write("GET /third HTTP/1.1\r\nHost: x\r\n\r\n");
    }
    if (wire.endsWith("third")) done.resolve();
  });
  client.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\n\r\n");
  await done.promise;
  client.destroy();
  server.closeAllConnections();
  if (server.listening) server.close();
  process.off("uncaughtException", onUncaught);
  // The bodies, in the order of the wire.
  const bodies = wire
    .split("\r\n\r\n")
    .slice(1)
    .map(part => part.split("HTTP/1.1")[0]);
  console.log(JSON.stringify({ name, transport, uncaught, events, bodies }));
}

async function handovers() {
  for (const transport of ["tcp", "duplex"]) {
    await handover("a 'socket' listener of a response that ended throws", transport, res => {
      res.on("socket", () => {
        throw new Error("socket listener");
      });
      res.end("second");
    });
    await handover("a 'socket' listener of a response that did not end throws", transport, res => {
      res.on("socket", () => {
        setImmediate(() => res.end("second"));
        throw new Error("socket listener");
      });
      res.setHeader("Content-Length", 6);
      res.flushHeaders();
    });
    await handover("a 'prefinish' listener throws", transport, res => {
      res.on("prefinish", () => {
        throw new Error("prefinish listener");
      });
      res.end("second");
    });
  }
}

if (suite === "memory") await memory();
else if (suite === "handover") await handovers();
