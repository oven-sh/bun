import { expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, IncomingMessage } from "node:http";
import { connect, type AddressInfo } from "node:net";

const pipelinedGet = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`;
const pipelinedPost = (path: string, body: string) =>
  `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: ${body.length}\r\n\r\n${body}`;

// Writes `requests` as a single segment and collects bytes until every response
// has arrived. Resolving on "close" too means a server that tears the
// connection down mid-pipeline yields the truncated bytes (an assertion
// failure) instead of hanging until the test times out.
function pipelineRequests(port: number, requests: string[]): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1");
  let data = "";
  socket.on("data", chunk => {
    data += chunk;
    const statusLines = data.split("HTTP/1.1 ").length - 1;
    const headerBlocks = data.split("\r\n\r\n").length - 1;
    if (statusLines >= requests.length && headerBlocks >= requests.length) {
      socket.destroy();
      resolve(data);
    }
  });
  socket.on("close", () => resolve(data));
  socket.on("error", reject);
  socket.on("connect", () => socket.write(requests.join("")));
  return promise;
}

const statusesOf = (raw: string) => [...raw.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(m => m[1]);

it("the over-limit 503 advertises Connection: close, not keep-alive", async () => {
  // Node sets maxRequestsOnConnectionReached unconditionally
  // (maxRequestsPerSocket <= count), so the dropRequest 503 carries
  // Connection: close instead of advertising keep-alive.
  const server = createServer((req, res) => res.end("ok"));
  server.maxRequestsPerSocket = 1;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    // Two pipelined requests: the second exceeds maxRequestsPerSocket.
    const out = await pipelineRequests(port, [pipelinedGet("/a"), pipelinedGet("/b")]);

    const second = out.slice(out.indexOf("HTTP/1.1 503"));
    expect(second).toContain("HTTP/1.1 503");
    expect(second).toContain("Connection: close");
    expect(second).not.toContain("keep-alive");
  } finally {
    server.close();
  }
});

it("every pipelined request past maxRequestsPerSocket gets its own 503 and dropRequest", async () => {
  // Node answers each over-limit request with a 503 and emits 'dropRequest'
  // for it, so a client that pipelined several requests at once is not left
  // with a torn-down connection and no response.
  const drops: { url: string; isIncomingMessage: boolean; socket: unknown }[] = [];
  const server = createServer((req, res) => {
    req.resume();
    res.end("ok");
  });
  server.maxRequestsPerSocket = 1;
  server.on("dropRequest", (req, socket) =>
    drops.push({ url: req.url, isIncomingMessage: req instanceof IncomingMessage, socket }),
  );
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    // Three requests pipelined into one segment: /b and /c are both over the
    // limit of 1, so both must be answered.
    const out = await pipelineRequests(port, [pipelinedGet("/a"), pipelinedGet("/b"), pipelinedGet("/c")]);

    expect(statusesOf(out)).toEqual(["200", "503", "503"]);
    expect(drops.map(({ url, isIncomingMessage }) => ({ url, isIncomingMessage }))).toEqual([
      { url: "/b", isIncomingMessage: true },
      { url: "/c", isIncomingMessage: true },
    ]);
    // Both drops report the one connection they arrived on.
    expect(drops[0].socket).toBeDefined();
    expect(drops[1].socket).toBe(drops[0].socket);
  } finally {
    server.close();
  }
});

it("a dropped request carrying a body does not stall the rest of the pipeline", async () => {
  // The 503'd request's body still has to come off the wire, otherwise the
  // parser never reaches the request pipelined behind it.
  const drops: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    res.end("ok");
  });
  server.maxRequestsPerSocket = 1;
  server.on("dropRequest", req => drops.push(req.url));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const body = "hello=world";
    const out = await pipelineRequests(port, [
      pipelinedPost("/a", body),
      pipelinedPost("/b", body),
      pipelinedPost("/c", body),
    ]);

    expect(statusesOf(out)).toEqual(["200", "503", "503"]);
    expect(drops).toEqual(["/b", "/c"]);
  } finally {
    server.close();
  }
});

it("requests arriving after maxRequestsPerSocket keep getting 503s on the same connection", async () => {
  // Node's docs: at the limit the server "will set the Connection header value
  // to close, but will not actually close the connection"; later requests get
  // a 503 each rather than a dead socket.
  const drops: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    res.end("ok");
  });
  server.maxRequestsPerSocket = 1;
  server.on("dropRequest", req => drops.push(req.url));
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const out = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      let data = "";
      let sent = 0;
      const paths = ["/a", "/b", "/c"];
      const sendNext = () => socket.write(pipelinedGet(paths[sent++]));
      socket.on("data", chunk => {
        data += chunk;
        // One request at a time, each written only after the previous response
        // landed, so nothing is ever sitting in the server's read buffer.
        if (statusesOf(data).length === sent) {
          if (sent === paths.length) {
            socket.destroy();
            resolve(data);
          } else {
            sendNext();
          }
        }
      });
      socket.on("close", () => resolve(data));
      socket.on("error", reject);
      socket.on("connect", sendNext);
    });

    expect(statusesOf(out)).toEqual(["200", "503", "503"]);
    expect(drops).toEqual(["/b", "/c"]);
  } finally {
    server.close();
  }
});
