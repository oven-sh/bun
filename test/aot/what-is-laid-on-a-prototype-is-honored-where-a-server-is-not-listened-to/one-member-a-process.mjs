// What a program lays on the prototype of the class of a request, a response or their socket is honored on the roads that a server takes when nobody listens.
// ONE MEMBER A PROCESS: what is laid on a prototype is noticed once and for all, so a second case in the same process would go other ways than a program that does this one thing.
// CASE names the case: "<subject> . <member> . <answer>". Without it the cases are listed. Two requests on one connection that stays open; the member is laid between them.
// A method is wrapped and its calls on the second request's objects are written down; an accessor answers another value. How often a member is read is not looked at.
import http from "node:http";
import net from "node:net";

const members = {
  "nothing": ["-"],
  "the request": [
    "_destroy",
    "_dump",
    "_read",
    "destroy",
    "emit",
    "listenerCount",
    "push",
    "read",
    "removeAllListeners",
    "resume",
    "readableEnded",
    "destroyed",
  ],
  "the response": [
    "_callPendingCallbacks",
    "_isLenientHeaderValidation",
    "detachSocket",
    "emit",
    "getHeader",
    "hasHeader",
    "on",
    "setHeader",
    "headersSent",
    "socket",
    "writableHighWaterMark",
  ],
  "the socket": [
    "_unrefTimer",
    "removeListener",
    "resume",
    "setTimeout",
    "destroyed",
    "readable",
    "readableEnded",
    "readableHighWaterMark",
    "readableLength",
    "writableEnded",
    "writableHighWaterMark",
  ],
};
const answers = {
  "end with a text": { handle: (req, res) => res.end("ok") },
  "a header, a head, two writes, end": {
    handle(req, res) {
      res.setHeader("x-made-up", "1");
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("a");
      res.write("b");
      res.end();
    },
  },
  "the body by listeners": {
    body: "x".repeat(1000),
    handle(req, res) {
      let length = 0;
      req.on("data", part => (length += part.length));
      req.on("end", () => res.end(String(length)));
    },
  },
  "the body in a loop": {
    body: "x".repeat(1000),
    async handle(req, res) {
      let length = 0;
      for await (const part of req) length += part.length;
      res.end(String(length));
    },
  },
  "the body is left alone": { body: "x".repeat(1000), handle: (req, res) => res.end("ok") },
  "the body by readable and read": {
    body: "x".repeat(1000),
    handle(req, res) {
      let length = 0;
      req.on("readable", () => {
        for (let part = req.read(); part !== null; part = req.read()) length += part.length;
      });
      req.on("end", () => res.end(String(length)));
    },
  },
  "the body by readable and read, with a read of its own from the first time on": {
    body: "x".repeat(1000),
    handle(req, res) {
      let length = 0;
      req.on("readable", () => {
        if (!Object.hasOwn(req, "read")) {
          req.read = function (...values) {
            if (requests === 2) seen.push("its own read(" + values.map(kinds).join(" ") + ")");
            return http.IncomingMessage.prototype.read.apply(this, values);
          };
        }
        for (let part = req.read(); part !== null; part = req.read()) length += part.length;
      });
      req.on("end", () => res.end(String(length)));
    },
  },
  "the body is announced, gets a read of its own and is read a turn later": {
    body: "x".repeat(1000),
    handle(req, res) {
      let length = 0;
      req.on("readable", () => {
        if (Object.hasOwn(req, "read")) return;
        req.read = function (...values) {
          if (requests === 2) seen.push("its own read(" + values.map(kinds).join(" ") + ")");
          return http.IncomingMessage.prototype.read.apply(this, values);
        };
        setImmediate(() => {
          for (let part = req.read(); part !== null; part = req.read()) length += part.length;
        });
      });
      req.on("end", () => res.end(String(length)));
    },
  },
  "end with a text, somebody listens for the close of the request": {
    handle(req, res) {
      req.on("close", () => requests === 2 && seen.push("the request closes"));
      res.end("ok");
    },
  },
  "end with a text, the request says that it is writable": {
    handle(req, res) {
      req.writable = true;
      res.end("ok");
    },
  },
  "end with a text, somebody listens for the finish of the response": {
    handle(req, res) {
      res.on("finish", () => requests === 2 && seen.push("the response finishes"));
      res.end("ok");
    },
  },
};
const cases = [];
const answersWithMember = ["end with a text", "a header, a head, two writes, end", "the body by listeners"];
for (const subject in members)
  for (const member of members[subject])
    for (const answer of subject === "nothing" ? Object.keys(answers) : answersWithMember)
      cases.push(`${subject} . ${member} . ${answer}`);
if (!process.env.CASE) {
  console.log(cases.join("\n"));
  process.exit(0);
}
const [subject, member, answer] = process.env.CASE.split(" . ");

const seen = [];
let watched;
let made;
let requests = 0;
const kinds = value =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "list"
      : typeof value === "string" && value.length < 20
        ? JSON.stringify(value)
        : typeof value;
function other(value) {
  switch (typeof value) {
    case "boolean":
      return !value;
    case "number":
      return value + 1;
    case "undefined":
      return null;
    default:
      return value === null ? undefined : null;
  }
}
function lay(sample) {
  if (!sample) return;
  const above = Object.getPrototypeOf(sample);
  let holder = above;
  while (holder && !Object.hasOwn(holder, member)) holder = Object.getPrototypeOf(holder);
  if (!holder) return void seen.push("NOT THERE");
  const found = Object.getOwnPropertyDescriptor(holder, member);
  if (typeof found.value === "function") {
    above[member] = function (...values) {
      if (this === watched) seen.push(member + "(" + values.map(kinds).join(" ") + ")");
      return Reflect.apply(found.value, this, values);
    };
  } else if (found.get && (holder !== above || found.configurable)) {
    Object.defineProperty(above, member, {
      configurable: true,
      enumerable: found.enumerable,
      get() {
        const value = found.get.call(this);
        return this === watched ? other(value) : value;
      },
      set(value) {
        found.set?.call(this, value);
      },
    });
  } else seen.push("CANNOT BE LAID");
}
const subjectOf = (req, res) =>
  subject === "the request"
    ? req
    : subject === "the response"
      ? res
      : subject === "the socket"
        ? req.socket
        : undefined;
process.on("uncaughtException", error => seen.push("UNCAUGHT " + (error?.code ?? error?.name)));
const server = http.createServer((req, res) => {
  made = { req, res, socket: req.socket };
  if (++requests === 2) watched = subjectOf(req, res);
  try {
    Promise.resolve(answers[answer].handle(req, res)).catch(error =>
      seen.push("REJECTED " + (error?.code ?? error?.name)),
    );
  } catch (error) {
    seen.push("THREW " + (error?.code ?? error?.name));
    try {
      res.end("threw");
    } catch {}
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const client = net.connect(server.address().port, "127.0.0.1");
client.setEncoding("latin1");
client.on("error", () => {});
let arrived = "";
let look = () => {};
let isClosed = false;
client.on("data", part => {
  arrived += part;
  look();
});
client.on("close", () => {
  isClosed = true;
  look();
});
function isWhole() {
  const end = arrived.indexOf("\r\n\r\n");
  if (end < 0) return false;
  const length = /\r\ncontent-length: (\d+)/i.exec(arrived.slice(0, end));
  if (length) return arrived.length >= end + 4 + Number(length[1]);
  return arrived.endsWith("0\r\n\r\n");
}
function ask() {
  return new Promise(resolve => {
    arrived = "";
    const patience = setTimeout(() => finish("NO ANSWER"), 3000);
    const finish = word => {
      clearTimeout(patience);
      look = () => {};
      const lines = arrived.split("\r\n").filter(line => !/^date:/i.test(line));
      resolve(word + " " + JSON.stringify(lines.join("|")));
    };
    look = () => {
      if (isWhole()) finish("whole");
      else if (isClosed) finish("CUT");
    };
    const body = answers[answer].body;
    client.write(
      body
        ? `POST / HTTP/1.1\r\nHost: a\r\nContent-Length: ${body.length}\r\n\r\n${body}`
        : "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
    );
    look();
  });
}
const rest = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
};

const first = await ask();
await rest();
lay(subjectOf(made.req, made.res));
const second = await ask();
await rest();
watched = undefined;
const { req, res, socket } = made;
console.log(process.env.CASE);
console.log("  first:", first);
console.log("  second:", second);
console.log("  seen:", seen.join(", "));
console.log(
  "  the request:",
  `ended ${req.readableEnded} destroyed ${req.destroyed} complete ${req.complete} aborted ${req.aborted}`,
);
console.log(
  "  the response:",
  `finished ${res.finished} ended ${res.writableEnded} destroyed ${res.destroyed} sent ${res.headersSent}`,
);
console.log(
  "  the socket:",
  `destroyed ${socket.destroyed} readable ${socket.readable} closed at the client ${isClosed}`,
);
process.exit(0);
