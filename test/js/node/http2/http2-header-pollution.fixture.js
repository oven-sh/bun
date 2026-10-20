// Puts one HTTP/2 header name on Object.prototype, calls a node:http2 method that builds a header
// block, and prints what the peer receives. The peer is never polluted: this file runs as a
// driver (the peer) and starts itself again with "polluted" as the process under test.
// Run under Node.js and under Bun: the output must be identical.
const http2 = require("node:http2");
const fs = require("node:fs");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { sensitiveHeaders } = http2;

const respondThenEnd = stream => {
  stream.respond({ ":status": 200 });
  stream.end("body");
};
const push = (stream, failed) => {
  stream.pushStream({ ":path": "/p" }, (err, pushed) => {
    if (err) return failed(err);
    pushed.respond({ ":status": 200 });
    pushed.end("pushed");
  });
  respondThenEnd(stream);
};
// The value is new in each request: HPACK sends a value that is in its table as a reference, with
// no never-index flag.
let unique = 0;

// `how` is the property on Object.prototype: "enumerable" and "hidden" are data properties,
// "read-only" is not writable, "accessor" has a getter and a setter. A server case gets the
// stream and answers the request. When it throws, the stream still answers with a 200.
const cases = [
  { call: 'request({ ":path": "/x" })', key: ":method", value: "DELETE", run: s => s.request({ ":path": "/x" }) },
  {
    call: 'request({ ":path": "/x" })',
    key: ":authority",
    value: "evil.example",
    run: s => s.request({ ":path": "/x" }),
  },
  { call: 'request({ ":path": "/x" })', key: ":scheme", value: "https", run: s => s.request({ ":path": "/x" }) },
  { call: 'request({ ":path": "/x" })', key: "host", value: "evil.example", run: s => s.request({ ":path": "/x" }) },
  { call: "request()", key: ":path", value: "/pol", how: ["enumerable", "hidden", "read-only"], run: s => s.request() },
  { call: "request()", key: ":method", value: "DELETE", how: ["accessor"], run: s => s.request() },
  // The names that HPACK must never index are kept by name too.
  {
    call: "request({ authorization })",
    key: "authorization",
    value: "polluted",
    how: ["read-only", "accessor"],
    run: s => s.request({ authorization: `a${unique++}` }),
  },
  {
    call: "request({ cookie })",
    key: "cookie",
    value: "polluted",
    how: ["read-only", "accessor"],
    run: s => s.request({ cookie: `c=${unique++}` }),
  },
  {
    call: 'request({ "x-secret", [http2.sensitiveHeaders]: ["x-secret"] })',
    key: "x-secret",
    value: "polluted",
    how: ["read-only", "accessor"],
    run: s => s.request({ "x-secret": `s${unique++}`, [sensitiveHeaders]: ["x-secret"] }),
  },
  {
    server: true,
    call: "respond()",
    key: ":status",
    value: 302,
    how: ["enumerable", "hidden", "read-only", "accessor"],
    run: stream => {
      stream.respond();
      stream.end("body");
    },
  },
  // A status that is out of range makes respond() throw.
  {
    server: true,
    call: "respond()",
    key: ":status",
    value: 700,
    how: ["out of range"],
    run: stream => {
      stream.respond();
      stream.end("body");
    },
  },
  { server: true, call: 'end("body")', key: ":status", value: 302, run: stream => stream.end("body") },
  {
    server: true,
    call: 'respondWithFile(path, { a: "1" })',
    key: ":status",
    value: 302,
    run: stream => stream.respondWithFile(__filename, { a: "1" }, { length: 4 }),
  },
  {
    server: true,
    call: "respondWithFile(path)",
    key: ":status",
    value: 302,
    run: stream => stream.respondWithFile(__filename, undefined, { length: 4 }),
  },
  {
    server: true,
    call: 'respondWithFD(fd, { a: "1" })',
    key: ":status",
    value: 302,
    run: stream => {
      const fd = fs.openSync(__filename, "r");
      stream.on("close", () => fs.closeSync(fd));
      stream.respondWithFD(fd, { a: "1" }, { length: 4 });
    },
  },
  {
    server: true,
    call: "respondWithFD(fd)",
    key: ":status",
    value: 302,
    run: stream => {
      const fd = fs.openSync(__filename, "r");
      stream.on("close", () => fs.closeSync(fd));
      stream.respondWithFD(fd, undefined, { length: 4 });
    },
  },
  {
    server: true,
    call: 'respond({ ":status": 200 })',
    key: "date",
    value: "polluted",
    how: ["enumerable", "hidden", "read-only"],
    run: respondThenEnd,
  },
  {
    server: true,
    call: 'additionalHeaders({ ":status": 103 })',
    key: ":pol",
    value: "1",
    run: stream => {
      stream.additionalHeaders({ ":status": 103 });
      respondThenEnd(stream);
    },
  },
  { server: true, call: 'pushStream({ ":path": "/p" })', key: "te", value: "gzip", run: push },
  { server: true, call: 'pushStream({ ":path": "/p" })', key: "connection", value: "close", run: push },
  // node reads the never-index list of a response through the caller's object, and that of
  // every other block from the copy. The list must be an array.
  {
    server: true,
    call: 'respond({ ":status": 200 })',
    key: sensitiveHeaders,
    value: "not an array",
    how: ["enumerable"],
    run: respondThenEnd,
  },
  {
    server: true,
    call: 'sendTrailers({ "x-t": "1" })',
    key: sensitiveHeaders,
    value: "not an array",
    how: ["enumerable"],
    late: true,
    run: (stream, failed, step) => {
      stream.respond({ ":status": 200 }, { waitForTrailers: true });
      stream.on("wantTrailers", () => {
        pollute(step);
        try {
          stream.sendTrailers({ "x-t": "1" });
        } catch (e) {
          failed(e);
          stream.close();
        }
      });
      stream.end("body");
    },
  },
];
const steps = [];
for (const c of cases) {
  for (const how of c.how ?? ["enumerable", "hidden"]) steps.push({ ...c, how });
}

let setterCalls = 0;
function pollute({ key, value, how }) {
  Object.defineProperty(
    Object.prototype,
    key,
    how === "accessor"
      ? { configurable: true, get: () => value, set: () => void setterCalls++ }
      : { configurable: true, value, enumerable: how !== "hidden", writable: how !== "read-only" },
  );
}

const isDate = value => typeof value === "string" && !Number.isNaN(Date.parse(value));

async function driver() {
  // The clean peer of the requests: it answers with what it received.
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    const authority = headers[":authority"] === `127.0.0.1:${server.address().port}` ? "peer" : headers[":authority"];
    const list = headers[sensitiveHeaders] ?? [];
    const neverIndexed = list.length ? `, never indexed: ${list}` : "";
    stream.respond({ ":status": 200 });
    stream.end(`${headers[":method"]} ${headers[":scheme"]} ${authority} ${headers[":path"]}${neverIndexed}`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const child = spawn(process.execPath, [__filename, "polluted", String(server.address().port)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  child.stdout.setEncoding("utf8");
  const messages = [];
  const waiting = [];
  let buffered = "";
  child.stdout.on("data", chunk => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const message = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      if (waiting.length) waiting.shift()(message);
      else messages.push(message);
    }
  });
  const nextMessage = () => (messages.length ? messages.shift() : new Promise(resolve => waiting.push(resolve)));

  const lines = [];
  const report = (step, text) =>
    lines.push(
      `${step.call} | ${typeof step.key === "symbol" ? "[http2.sensitiveHeaders]" : JSON.stringify(step.key)} ${step.how}: ${text}`,
    );

  // The process under test makes its requests first.
  for (const step of steps) {
    if (!step.server) report(step, (await nextMessage()).answer);
  }

  // Then it is the server, and this process is the clean client of each call.
  const { port } = await nextMessage();
  const client = http2.connect(`http://127.0.0.1:${port}`);
  const pushes = [];
  client.on("stream", (pushed, headers) => {
    pushed.resume();
    pushes.push(headers[":path"]);
  });
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.server) continue;
    pushes.length = 0;
    const seen = [];
    const req = client.request({ ":path": `/${i}` });
    req.on("headers", headers => seen.push(`info ${headers[":status"]}`));
    req.on("response", headers => {
      seen.push(`status ${headers[":status"]}`);
      if (step.key === "date") seen.push(isDate(headers.date) ? "with a date" : `date ${JSON.stringify(headers.date)}`);
    });
    req.on("trailers", headers => seen.push(`trailers ${Object.keys(headers)}`));
    req.on("error", e => seen.push(`error ${e.code}`));
    req.resume();
    req.end();
    await new Promise(resolve => req.on("close", resolve));
    const { threw } = await nextMessage();
    if (threw) seen.unshift(`throws ${threw}`);
    for (const path of pushes) seen.push(`push ${path}`);
    report(step, seen.join(", "));
  }
  client.close();
  server.close();
  const [exitCode] = await exited;
  if (exitCode !== 0) throw new Error(`the process under test exited with code ${exitCode}`);
  console.log(lines.join("\n"));
}

async function polluted(port) {
  const send = message => console.log(JSON.stringify(message));
  const client = http2.connect(`http://127.0.0.1:${port}`);
  await once(client, "connect");
  for (const step of steps) {
    if (step.server) continue;
    setterCalls = 0;
    pollute(step);
    let answer;
    try {
      const req = step.run(client);
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => (body += chunk));
      req.on("error", e => (answer = `error ${e.code}`));
      req.end();
      await new Promise(resolve => req.on("close", resolve));
      answer ??= body;
    } catch (e) {
      answer = `throws ${e.code ?? e.name}`;
    }
    delete Object.prototype[step.key];
    if (setterCalls) answer += `, setter calls: ${setterCalls}`;
    send({ answer });
  }
  client.close();

  const server = http2.createServer();
  let last;
  server.on("stream", (stream, headers) => {
    if (last) delete Object.prototype[last.key];
    const step = (last = steps[headers[":path"].slice(1)]);
    let threw;
    const failed = e => (threw = e.code ?? String(e));
    stream.on("error", () => {});
    stream.on("close", () => send({ threw }));
    if (!step.late) pollute(step);
    try {
      step.run(stream, failed, step);
    } catch (e) {
      failed(e);
      delete Object.prototype[step.key];
      respondThenEnd(stream);
    }
  });
  server.on("session", session => session.on("close", () => server.close()));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  send({ port: server.address().port });
}

if (process.argv[2] === "polluted") polluted(process.argv[3]);
else driver();
