import http from "node:http";
import net from "node:net";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

const large = "x".repeat(40_000);

interface Answer {
  status?: number;
  message?: string;
  headers?: Record<string, string | number | string[]>;
  body?: string | Uint8Array;
  encoding?: BufferEncoding;
}

const answers: Record<string, Answer> = {
  text: { headers: { "Content-Type": "text/plain" }, body: "hello" },
  bare: { body: "hello" },
  "several-values": { headers: { "X-One": "1", "X-Two": ["a", "b"] }, body: "hello" },
  message: { message: "Fine By Me", headers: { "Content-Type": "text/plain" }, body: "hello" },
  "long-message": { message: "m".repeat(200), body: "hello" },
  "own-length": { headers: { "content-LENGTH": "5" }, body: "hello" },
  "number-values": { headers: { "Content-Length": 5, "X-Number": 17 }, body: "hello" },
  "own-date": { headers: { DATE: "yesterday" }, body: "hello" },
  "empty-value": { headers: { "X-Empty": "" }, body: "hello" },
  nothing: { headers: { "Content-Type": "text/plain" } },
  "empty-text": { body: "" },
  buffer: { headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from([104, 0, 255, 10]) },
  bytes: { body: new Uint8Array([1, 2, 3]) },
  utf8: { body: "caf\u00e9 \u4f60\u597d \ud83d\ude00" },
  "latin1-text": { body: "caf\u00e9" },
  hex: { body: "68656c6c6f", encoding: "hex" },
  "latin1-encoding": { body: "caf\u00e9", encoding: "latin1" },
  large: { body: large },
  "nearly-too-large": { body: "z".repeat(16_100) },
  "many-headers": { headers: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["X-Header-" + i, "value " + i])), body: "hello" },
  "large-header": { headers: { "X-Large": "y".repeat(20_000) }, body: "hello" },
  "204": { status: 204 },
  "204-with-body": { status: 204, body: "hello" },
  "304": { status: 304, headers: { ETag: '"a"' } },
  "404": { status: 404, headers: { "Content-Type": "text/plain" }, body: "nothing here" },
  "chunked-header": { headers: { "Transfer-Encoding": "chunked" }, body: "hello" },
  close: { headers: { Connection: "close" }, body: "hello" },
  "keep-alive": { headers: { Connection: "keep-alive" }, body: "hello" },
};

function end(response: http.ServerResponse, { body, encoding }: Answer) {
  if (body === undefined) response.end();
  else if (encoding === undefined) response.end(body);
  else response.end(body, encoding);
}

function answerWithHead(response: http.ServerResponse, answer: Answer) {
  if (answer.message === undefined) response.writeHead(answer.status ?? 200, answer.headers);
  else response.writeHead(answer.status ?? 200, answer.message, answer.headers);
  end(response, answer);
}

function answerAtOnce(response: http.ServerResponse, answer: Answer) {
  if (answer.status !== undefined) response.statusCode = answer.status;
  if (answer.message !== undefined) response.statusMessage = answer.message;
  for (const [name, value] of Object.entries(answer.headers ?? {})) response.setHeader(name, value);
  end(response, answer);
}

const handlers: Record<string, Handler> = {
  "/rope-value": (request, response) => {
    response.setHeader("X-Rope", "you asked for " + request.url + " by " + request.method);
    response.end("hello");
  },
  "/rope-body": (request, response) => {
    response.end("you asked for " + request.url + " by " + request.method);
  },
  "/callback": (_, response) => {
    response.end("hello", () => {
      finished.push("callback");
    });
  },
  "/write-then-end": (_, response) => {
    response.write("hel");
    response.end("lo");
  },
  "/trailers": (_, response) => {
    response.setHeader("Trailer", "X-After");
    response.addTrailers({ "X-After": "done" });
    response.end("hello");
  },
  "/later": (_, response) => {
    setTimeout(() => {
      response.setHeader("Content-Type", "text/plain");
      response.end("hello");
    }, 5);
  },
  "/in-a-microtask": async (_, response) => {
    await null;
    response.setHeader("Content-Type", "text/plain");
    response.end("hello");
  },
  "/without-date": (_, response) => {
    response.sendDate = false;
    response.end("hello");
  },
  "/events": (_, response) => {
    response.on("finish", () => finished.push("finish"));
    response.on("close", () => finished.push("close"));
    response.end("hello");
    finished.push(`ended ${response.writableEnded} sent ${response.headersSent}`);
  },
  "/twice": (_, response) => {
    response.on("error", error => finished.push((error as NodeJS.ErrnoException).code ?? "no code"));
    response.end("hello");
    response.end("again");
    try {
      response.writeHead(201);
    } catch (error) {
      finished.push((error as NodeJS.ErrnoException).code ?? "no code");
    }
  },
  "/strict": (_, response) => {
    response.strictContentLength = true;
    response.setHeader("Content-Length", 5);
    response.end("hello");
  },
  "/strict-and-wrong": (_, response) => {
    response.strictContentLength = true;
    response.setHeader("Content-Length", 4);
    try {
      response.end("hello");
    } catch (error) {
      finished.push((error as NodeJS.ErrnoException).code ?? "no code");
      response.strictContentLength = false;
      response.end("hell");
    }
  },
};
for (const [name, answer] of Object.entries(answers)) {
  handlers["/" + name] = (_, response) => answerAtOnce(response, answer);
  handlers["/head/" + name] = (_, response) => answerWithHead(response, answer);
}

const finished: string[] = [];

const server = http.createServer((request, response) => {
  const handler = handlers[request.url ?? ""];
  if (handler === undefined) {
    response.writeHead(500);
    response.end("no such case");
    return;
  }
  handler(request, response);
});

function show(bytes: Buffer): string {
  return JSON.stringify(bytes.toString("latin1").replace(/Date: [A-Z][^\r]*GMT/g, "Date: <now>").replaceAll(large, "<large>").replaceAll("y".repeat(20_000), "<large header>").replaceAll("z".repeat(16_100), "<nearly too large>").replaceAll("m".repeat(200), "<long message>"));
}

function ask(port: number, text: string, isDone: (received: Buffer) => boolean): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const socket = net.connect(port, "127.0.0.1");
  const chunks: Buffer[] = [];
  const finish = () => {
    socket.destroy();
    resolve(Buffer.concat(chunks));
  };
  socket.on("data", chunk => {
    chunks.push(chunk);
    if (isDone(Buffer.concat(chunks))) finish();
  });
  socket.on("end", finish);
  socket.on("error", reject);
  socket.write(text);
  return promise;
}

function countOfResponses(received: Buffer): number {
  let count = 0;
  let rest = received.toString("latin1");
  for (;;) {
    const end = rest.indexOf("\r\n\r\n");
    if (end < 0) return count;
    const head = rest.slice(0, end);
    let body = rest.slice(end + 4);
    const length = /^content-length: (\d+)$/im.exec(head);
    if (/^transfer-encoding: chunked$/im.test(head)) {
      const last = /(^|\r\n)0\r\n([^\r]+\r\n)*\r\n/.exec(body);
      if (last === null) return count;
      body = body.slice(last.index + last[0].length);
    } else if (length !== null) {
      if (body.length < Number(length[1])) return count;
      body = body.slice(Number(length[1]));
    }
    count++;
    rest = body;
  }
}

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address() as net.AddressInfo;
  const request = (method: string, path: string, version = "1.1", more = "") => `${method} ${path} HTTP/${version}\r\nHost: localhost\r\n${more}\r\n`;
  for (const path of Object.keys(handlers)) {
    const received = await ask(port, request("GET", path), received => countOfResponses(received) === 1);
    if (path !== "/strict-and-wrong") console.log("GET", path, show(received));
  }
  console.log("HEAD /text", show(await ask(port, request("HEAD", "/text") + request("GET", "/nothing"), received => received.toString("latin1").split("HTTP/1.1 ").length === 3)));
  console.log("HTTP/1.0 /text", show(await ask(port, request("GET", "/text", "1.0"), () => false)));
  console.log("HTTP/1.0 keep-alive /text", show(await ask(port, request("GET", "/text", "1.0", "Connection: keep-alive\r\n"), received => countOfResponses(received) === 1)));
  console.log("close asked /text", show(await ask(port, request("GET", "/text", "1.1", "Connection: close\r\n"), () => false)));
  console.log("pipelined", show(await ask(port, request("GET", "/text") + request("GET", "/later") + request("GET", "/404"), received => countOfResponses(received) === 3)));
  console.log("POST /text", show(await ask(port, request("POST", "/text", "1.1", "Content-Length: 3\r\n") + "abc", received => countOfResponses(received) === 1)));
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log(finished.join(", "));
  server.close();
});
