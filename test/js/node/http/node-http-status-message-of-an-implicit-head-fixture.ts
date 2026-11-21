// Prints what `res.statusMessage` holds around a first write() or end() that no writeHead() came before, beside the status line
// that the client receives. Node.js v26.3.0 and v26.12.1 print the same lines up to the last group, which only Bun prints.
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { duplexPair } from "node:stream";

type Response = http.ServerResponse & Record<string | symbol, any>;
type Handler = (res: Response, note: (text: string) => void) => void;
type Case = [
  name: string,
  handler: Handler,
  options?: http.ServerOptions | null,
  requestLine?: string,
  isUntouched?: boolean,
];

const show = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : String(value));

// Every store to `statusMessage` of this response, through an own accessor.
function recordStores(res: Response): unknown[] {
  const stores: unknown[] = [];
  let value = res.statusMessage;
  Object.defineProperty(res, "statusMessage", {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: next => void (stores.push(next), (value = next)),
  });
  return stores;
}

function attempt(note: (text: string) => void, step: () => void) {
  try {
    step();
  } catch (error: any) {
    note(`throws ${error.code}`);
  }
}

const state = (res: Response) => `headersSent ${res.headersSent}, statusMessage ${show(res.statusMessage)}`;

// The program writes the table, answers, and takes the entry back.
function withStatusText(code: number, text: string, answer: () => void) {
  const original = http.STATUS_CODES[code];
  http.STATUS_CODES[code] = text;
  try {
    answer();
  } finally {
    if (original === undefined) delete http.STATUS_CODES[code];
    else http.STATUS_CODES[code] = original;
  }
}

const cases: Case[] = [
  ["end(chunk)", res => void res.end("ok")],
  ["end()", res => void res.end()],
  ["end(callback)", res => void res.end(() => {})],
  ['end("")', res => void res.end("")],
  ["write(chunk), end()", (res, note) => (res.write("ok"), note(`after write(): ${state(res)}`), void res.end())],
  ['write(""), end()', (res, note) => (res.write(""), note(`after write(): ${state(res)}`), void res.end())],
  ["a HEAD request, end(chunk)", res => void res.end("ok"), undefined, "HEAD / HTTP/1.1"],
  ["an HTTP/1.0 request, write(chunk), end()", res => (res.write("ok"), void res.end()), undefined, "GET / HTTP/1.0"],
  ["statusCode = 404, end()", res => ((res.statusCode = 404), void res.end())],
  ["statusCode = 204, end()", res => ((res.statusCode = 204), void res.end())],
  ["statusCode = 599, end()", res => ((res.statusCode = 599), void res.end())],
  ["statusCode = 306, end()", res => ((res.statusCode = 306), void res.end())],
  ["statusCode = 509, write(chunk), end()", res => ((res.statusCode = 509), res.write("ok"), void res.end())],
  ['statusMessage = "", end()', res => ((res.statusMessage = ""), void res.end())],
  ["statusMessage = null, write(chunk), end()", res => ((res.statusMessage = null), res.write("ok"), void res.end())],
  ['statusMessage = "Custom", end()', res => ((res.statusMessage = "Custom"), void res.end())],
  [
    'statusCode = 404, statusMessage = "OK", end()',
    res => ((res.statusCode = 404), (res.statusMessage = "OK"), void res.end()),
  ],
  ["flushHeaders(), end()", res => (res.flushHeaders(), void res.end())],
  ["writeHead(200), end()", res => (res.writeHead(200), void res.end())],
  [
    "STATUS_CODES[298] is written, end(chunk)",
    res => withStatusText(298, "Fine", () => ((res.statusCode = 298), void res.end("ok"))),
  ],
  [
    "a writeHead() of the program's own, end(chunk)",
    (res, note) => {
      const writeHead = res.writeHead;
      res.writeHead = function (this: Response, ...args: any[]) {
        note(`writeHead() is entered with statusMessage ${show(this.statusMessage)}`);
        return writeHead.apply(this, args as any);
      } as any;
      res.end("ok");
    },
  ],
  [
    "a writeHead() of the program's own, write(chunk), end()",
    (res, note) => {
      const writeHead = res.writeHead;
      res.writeHead = function (this: Response, ...args: any[]) {
        note(`writeHead() is entered with statusMessage ${show(this.statusMessage)}`);
        return writeHead.apply(this, args as any);
      } as any;
      res.write("ok");
      res.end();
    },
  ],
  ["destroy(), end(chunk)", res => (res.destroy(), void res.end("ok"))],
  ["destroy(), end()", res => (res.destroy(), void res.end())],
  ["destroy(), write(chunk)", res => (res.on("error", () => {}), res.destroy(), void res.write("ok", () => {}))],
  [
    "end(123), statusCode = 500, end(chunk)",
    (res, note) => {
      attempt(note, () => res.end(123 as any));
      note(`then ${state(res)}`);
      res.statusCode = 500;
      res.end("error");
    },
  ],
  [
    "write({}), statusCode = 500, end(chunk)",
    (res, note) => {
      attempt(note, () => res.write({} as any));
      note(`then ${state(res)}`);
      res.statusCode = 500;
      res.end("error");
    },
  ],
  [
    "statusCode = 99, end(), statusCode = 500, end()",
    (res, note) => {
      res.statusCode = 99;
      attempt(note, () => res.end());
      note(`then ${state(res)}`);
      res.statusCode = 500;
      res.end();
    },
  ],
  [
    "statusCode = 1000, write(chunk), statusCode = 500, end()",
    (res, note) => {
      res.statusCode = 1000;
      attempt(note, () => res.write("ok"));
      note(`then ${state(res)}`);
      res.statusCode = 500;
      res.end();
    },
  ],
];

// What only Bun prints. Node.js v26.11.0 and later keep the status line of a status code from its first use, so what they
// send for a table that the program writes depends on the responses before. And Node.js takes the head in front of
// ERR_HTTP_BODY_NOT_ALLOWED, so the second end() sends the first status code there.
const casesOfBun: Case[] = [
  ["STATUS_CODES[200] is written, end(chunk)", res => withStatusText(200, "Fine", () => void res.end("ok"))],
  [
    "STATUS_CODES[404] is written, write(chunk), end()",
    res => withStatusText(404, "Nowhere", () => ((res.statusCode = 404), res.write("ok"), void res.end())),
  ],
  [
    "STATUS_CODES[200] is written with a line break, a Content-Length, write(chunk), end(chunk)",
    (res, note) => {
      res.setHeader("Content-Length", 2);
      withStatusText(200, "Fi\nne", () => attempt(note, () => res.write("ok")));
      note(`then ${state(res)}`);
      res.statusMessage = "Mended";
      res.end("ok");
    },
    null,
    undefined,
    true,
  ],
  [
    "rejectNonStandardBodyWrites: statusCode = 204, end(chunk), statusCode = 500, end()",
    (res, note) => {
      res.statusCode = 204;
      attempt(note, () => res.end("ok"));
      note(`then ${state(res)}`);
      res.statusCode = 500;
      res.end();
    },
    { rejectNonStandardBodyWrites: true },
  ],
  [
    "rejectNonStandardBodyWrites: statusCode = 304, write(chunk), statusCode = 500, end()",
    (res, note) => {
      res.statusCode = 304;
      attempt(note, () => res.write("ok"));
      note(`then ${state(res)}`);
      res.statusCode = 500;
      res.end();
    },
    { rejectNonStandardBodyWrites: true },
  ],
];

// Sends the requests on one connection and gives back the status line of each response.
async function statusLines(port: number, requestLines: string[]): Promise<string[]> {
  const socket = net.connect(port, "127.0.0.1");
  let received = "";
  socket.setEncoding("latin1");
  socket.on("data", data => (received += data));
  socket.on("error", () => {});
  await once(socket, "connect");
  requestLines.forEach((requestLine, i) => {
    socket.write(`${requestLine}\r\nHost: a\r\n${i === requestLines.length - 1 ? "Connection: close\r\n" : ""}\r\n`);
  });
  await once(socket, "close");
  return received.match(/HTTP\/1\.1 \d{3} [^\r]*/g) ?? [];
}

async function listen(server: http.Server): Promise<number> {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return (server.address() as net.AddressInfo).port;
}

async function close(server: http.Server) {
  server.close();
  await once(server, "close");
}

async function runCases(list: Case[]) {
  for (const [name, handler, options, requestLine, isUntouched] of list) {
    const notes: string[] = [];
    const server = http.createServer(options ?? {}, (req, res: Response) => {
      // An accessor on the response takes it off the roads of a compiled program that are for a response as its class made it.
      const stores = isUntouched ? undefined : recordStores(res);
      res.on("finish", () => notes.push(`at 'finish': statusMessage ${show(res.statusMessage)}`));
      if (stores) res.on("close", () => notes.push(`stored: [${stores.map(show).join(", ")}]`));
      try {
        handler(res, text => notes.push(text));
      } catch (error: any) {
        notes.push(`the listener throws ${error.code}`);
        res.destroy();
      }
      notes.push(`after the listener: ${state(res)}`);
    });
    const lines = await statusLines(await listen(server), [requestLine ?? "GET / HTTP/1.1"]);
    await close(server);
    console.log(
      `${name}:\n    ${notes.join("\n    ")}\n    on the wire: ${lines.length === 0 ? "nothing" : lines.join(" | ")}`,
    );
  }
}

await runCases(cases);

// Every status code of the table and four more, each sent in three ways by a response that nothing was defined on.
{
  const codes = [...Object.keys(http.STATUS_CODES).map(Number), 299, 306, 599, 999];
  const ways: [string, (res: Response) => void][] = [
    ["end()", res => void res.end()],
    ['write(""), end()', res => (res.write(""), void res.end())],
    [
      "a Content-Length, write(chunk), end()",
      res => (res.setHeader("Content-Length", 2), res.write("ok"), void res.end()),
    ],
    [
      "a Content-Length, write(buffer), end()",
      res => (res.setHeader("Content-Length", 2), res.write(Buffer.from("ok")), void res.end()),
    ],
  ];
  const differing: string[] = [];
  for (const [way, answer] of ways) {
    const kept = new Map<number, unknown>();
    const server = http.createServer((req, res: Response) => {
      const code = Number(req.url!.slice(1));
      res.statusCode = code;
      answer(res);
      kept.set(code, res.statusMessage);
    });
    const port = await listen(server);
    for (const code of codes) {
      const [line] = await statusLines(port, [`GET /${code} HTTP/1.1`]);
      const text = http.STATUS_CODES[code] ?? "unknown";
      if (line !== `HTTP/1.1 ${code} ${text}` || kept.get(code) !== text) {
        differing.push(`${code}, ${way}: ${show(line)}, statusMessage ${show(kept.get(code))}`);
      }
    }
    await close(server);
  }
  console.log(
    `${codes.length} status codes, each sent in ${ways.length} ways:\n    ` +
      (differing.length === 0
        ? "the client receives the text of STATUS_CODES or 'unknown', and the response keeps it"
        : differing.join("\n    ")),
  );
}

// The same answer with `writeHead(statusCode)` in front of it keeps the same statusMessage and sends the same status line.
{
  const answers: [string, (res: Response) => void][] = [
    ["end()", res => void res.end()],
    ["end(chunk)", res => void res.end("ok")],
    ["write(chunk), end()", res => (res.write("ok"), void res.end())],
  ];
  const differing: string[] = [];
  let pairs = 0;
  let kept: unknown;
  let respond: (res: Response) => void;
  const server = http.createServer((req, res: Response) => {
    res.on("finish", () => (kept = res.statusMessage));
    respond(res);
  });
  const port = await listen(server);
  for (const requestLine of ["GET / HTTP/1.1", "HEAD / HTTP/1.1", "GET / HTTP/1.0"]) {
    for (const code of [200, 204, 404, 599]) {
      for (const statusMessage of [undefined, "", "Custom"]) {
        for (const [name, answer] of answers) {
          const seen: string[] = [];
          for (const explicit of [false, true]) {
            respond = res => {
              res.statusCode = code;
              if (statusMessage !== undefined) res.statusMessage = statusMessage;
              if (explicit) res.writeHead(res.statusCode);
              answer(res);
            };
            const [line] = await statusLines(port, [requestLine]);
            seen.push(`${line}, statusMessage ${show(kept)}`);
          }
          pairs++;
          if (seen[0] !== seen[1]) {
            differing.push(
              `${requestLine}, ${code}, statusMessage = ${show(statusMessage)}, ${name}: ${seen[0]} | ${seen[1]}`,
            );
          }
        }
      }
    }
  }
  await close(server);
  console.log(
    `${pairs} answers, each with and without writeHead(statusCode) in front:\n    ` +
      (differing.length === 0 ? "the same statusMessage and the same status line" : differing.join("\n    ")),
  );
}

// A chunk that the first write() or end() refuses is one that a write() or end() behind writeHead() refuses.
{
  const chunks: [string, () => unknown][] = [
    ["a string", () => "ok"],
    ['""', () => ""],
    ["undefined", () => undefined],
    ["a Buffer", () => Buffer.from("ok")],
    ["an empty Buffer", () => Buffer.alloc(0)],
    ["a Uint8Array", () => new Uint8Array(2)],
    ["123", () => 123],
    ["true", () => true],
    ["a bigint", () => 1n],
    ["a symbol", () => Symbol("chunk")],
    ["{}", () => ({})],
    ["an array", () => ["ok"]],
    ["a Date", () => new Date(0)],
    ["a Blob", () => new Blob(["ok"])],
    ["a Promise", () => Promise.resolve("ok")],
    ["a function taken for the callback", () => () => {}],
  ];
  const differing: string[] = [];
  let respond: (res: Response) => void;
  const server = http.createServer((req, res: Response) => respond(res));
  const port = await listen(server);
  for (const method of ["end", "write"]) {
    for (const [name, make] of chunks) {
      const seen: string[] = [];
      for (const explicit of [false, true]) {
        respond = res => {
          if (explicit) res.writeHead(200);
          try {
            res[method](make());
            seen.push("takes it");
          } catch (error: any) {
            seen.push(`throws ${error.code}`);
          }
          res.destroy();
        };
        await statusLines(port, ["GET / HTTP/1.1"]);
      }
      if (seen[0] !== seen[1]) differing.push(`${method}(${name}): ${seen[0]} | behind writeHead(): ${seen[1]}`);
    }
  }
  await close(server);
  console.log(
    `${chunks.length} chunks, each given to a first end() and a first write():\n    ` +
      (differing.length === 0 ? "refused or taken as behind writeHead()" : differing.join("\n    ")),
  );
}

// A connection that the program hands to the server is no socket of the server's own.
const handedCases: [string, Handler][] = [
  ["end(chunk)", res => void res.end("ok")],
  ["statusCode = 404, write(chunk), end()", res => ((res.statusCode = 404), res.write("ok"), void res.end())],
  ["statusCode = 599, end()", res => ((res.statusCode = 599), void res.end())],
  [
    'STATUS_CODES[200] is written, statusMessage = "OK", end(chunk)',
    res => withStatusText(200, "Fine", () => ((res.statusMessage = "OK"), void res.end("ok"))),
  ],
];

for (const [name, handler] of handedCases) {
  const notes: string[] = [];
  const server = http.createServer((req, res: Response) => {
    const stores = recordStores(res);
    handler(res, text => notes.push(text));
    notes.push(`after the listener: ${state(res)}`, `stored: [${stores.map(show).join(", ")}]`);
  });
  const [client, connection] = duplexPair();
  let received = "";
  client.setEncoding("latin1");
  client.on("data", data => (received += data));
  server.emit("connection", connection);
  client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
  await once(client, "end");
  client.destroy();
  console.log(
    `over a connection that the program hands over, ${name}:\n    ${notes.join("\n    ")}\n    on the wire: ${received.slice(0, received.indexOf("\r\n"))}`,
  );
}

// A response that waits behind the response of an earlier request on its connection.
const queuedCases: [string, Handler][] = [
  ["end(chunk)", res => void res.end("ok")],
  ["statusCode = 404, write(chunk), end()", res => ((res.statusCode = 404), res.write("ok"), void res.end())],
];

for (const [name, handler] of queuedCases) {
  const notes: string[] = [];
  let first: Response | undefined;
  const server = http.createServer((req, res: Response) => {
    if (req.url === "/0") {
      first = res;
      return;
    }
    const stores = recordStores(res);
    res.on("finish", () => notes.push(`at 'finish': statusMessage ${show(res.statusMessage)}`));
    res.on("close", () => notes.push(`stored: [${stores.map(show).join(", ")}]`));
    handler(res, text => notes.push(text));
    first!.end("first");
  });
  const lines = await statusLines(await listen(server), ["GET /0 HTTP/1.1", "GET /1 HTTP/1.1"]);
  await close(server);
  console.log(
    `a response that waits its turn, ${name}:\n    ${notes.join("\n    ")}\n    on the wire: ${lines.slice(1).join(" | ")}`,
  );
}

if (process.versions.bun !== undefined) {
  console.log("What follows is what Bun does. Node.js does otherwise, or not the same in every release.");
  await runCases(casesOfBun);
}
