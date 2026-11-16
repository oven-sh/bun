// Prints what the own properties of a server's response and socket hold through several exchanges, and the own keys of the
// objects that the socket inherits from.
const http = require("node:http");
const net = require("node:net");

const lines = [];
const nameOf = key => (typeof key === "symbol" ? `@${key.description}` : key);
function describe(value) {
  if (value === null || typeof value === "undefined" || typeof value === "boolean") return String(value);
  if (typeof value === "number") return value >= 10000 ? "a large number" : String(value);
  if (typeof value === "string") return `a string of ${value.length}`;
  if (typeof value === "function") return `function ${value.name}`;
  if (typeof value !== "object") return typeof value;
  if (Array.isArray(value)) return `an array of ${value.length}`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return `a ${prototype.constructor?.name}`;
  const entries = Reflect.ownKeys(value).map(key => {
    const entry = value[key];
    return `${nameOf(key)}: ${Array.isArray(entry) ? JSON.stringify(entry) : describe(entry)}`;
  });
  return `${prototype === null ? "[null] " : ""}{${entries.join(", ")}}`;
}
function list(label, object) {
  const words = [];
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    if ("value" in descriptor) words.push(`${nameOf(key)}=${describe(descriptor.value)}`);
  }
  lines.push(`${label}: ${words.join(" | ")}`);
}

const server = http.createServer((req, res) => {
  const at = req.url;
  list(`${at} res`, res);
  list(`${at} socket`, req.socket);
  res.on("finish", () => {
    list(`${at} res at finish`, res);
    list(`${at} socket at finish`, req.socket);
  });
  res.on("close", () => list(`${at} res at close`, res));
  const answer = () => {
    if (at === "/end") res.end("hello");
    else if (at === "/header") {
      res.setHeader("X-One", "1");
      list(`${at} res after setHeader`, res);
      res.appendHeader("x-one", "2");
      res.setHeader("X-Two", ["a", "b"]);
      res.setHeader("x-three", 3);
      list(`${at} res after four stores`, res);
      res.removeHeader("x-two");
      list(`${at} res after removeHeader`, res);
      res.end("ok");
    } else if (at === "/removed") {
      res.setHeader("x-one", "1");
      res.removeHeader("x-one");
      list(`${at} res after removeHeader`, res);
      res.end("ok");
    } else if (at === "/head") {
      res.setHeader("x-one", "1");
      res.writeHead(200, { "content-length": 2 });
      list(`${at} res after writeHead`, res);
      res.end("ok");
    } else if (at === "/length") {
      res.setHeader("content-length", 2);
      res.write("ok");
      list(`${at} res after write`, res);
      res.end();
    } else if (at === "/write") {
      res.write("a");
      list(`${at} res after write`, res);
      res.end();
    } else res.end("late");
    list(`${at} res after end`, res);
    process.nextTick(() => list(`${at} res a tick after end`, res));
  };
  if (at === "/late" || req.method === "POST") req.on("data", () => {}).on("end", answer);
  else answer();
});
server.on("connection", socket => {
  list("a socket at connection", socket);
  for (let above = Object.getPrototypeOf(socket), level = 1; above !== net.Socket.prototype; level++) {
    lines.push(`level ${level} above a socket: ${Reflect.ownKeys(above).map(nameOf).join(" ")}`);
    above = Object.getPrototypeOf(above);
  }
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const exchanges = [["/end"], ["/header"], ["/removed"], ["/head"], ["/length"], ["/write"], ["/late"], ["/post", "POST"]];
  const next = () => {
    const exchange = exchanges.shift();
    if (exchange === undefined) {
      agent.destroy();
      server.close(() => console.log(lines.join("\n")));
      return;
    }
    const [path, method = "GET"] = exchange;
    const request = http.request({ port, host: "127.0.0.1", path, agent, method }, response => {
      response.resume();
      response.on("close", () => setTimeout(next, 5));
    });
    request.end(method === "POST" ? "body" : undefined);
  };
  next();
});
