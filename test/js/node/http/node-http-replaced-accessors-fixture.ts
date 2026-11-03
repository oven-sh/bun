// Each request is answered after one member of the request or of the response has been replaced in one place. Each use the server makes of it is printed.
import { once } from "node:events";
import http, { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

let lines: string[] = [];
let restore: (() => void) | undefined;

function ownerOf(object: object, name: string) {
  let owner = object;
  while (!Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
  return owner;
}

function replaceOn(holder: object, name: string, original: PropertyDescriptor) {
  if (original.get) {
    Object.defineProperty(holder, name, {
      configurable: true,
      get() {
        const value = original.get!.call(this);
        lines.push(`get ${name}: ${typeof value === "object" ? (value === null ? "null" : "an object") : value}`);
        return value;
      },
      set(value) {
        lines.push(`set ${name}: ${value}`);
        original.set!.call(this, value);
      },
    });
  } else {
    Object.defineProperty(holder, name, {
      configurable: true,
      writable: true,
      value(this: unknown, ...args: unknown[]) {
        lines.push(`${name}(${args})`);
        return original.value.apply(this, args);
      },
    });
  }
}

type Place = (object: object, name: string, original: PropertyDescriptor, res: ServerResponse) => void;

function replaceOnPrototype(prototype: object): Place {
  return (_object, name, original) => {
    replaceOn(prototype, name, original);
    restore = () => void Reflect.deleteProperty(prototype, name);
  };
}

const places: Record<string, Place> = {
  "on the object": replaceOn,
  "on an heir of its prototype": (object, name, original) => {
    const heir = Object.create(Object.getPrototypeOf(object));
    replaceOn(heir, name, original);
    Object.setPrototypeOf(object, heir);
  },
  "on the object, beside a tick and a promise job": (object, name, original) => {
    replaceOn(object, name, original);
    process.nextTick(() => lines.push("a tick"));
    queueMicrotask(() => lines.push("a promise job"));
  },
  "on the object, by a listener of prefinish": (object, name, original, res) =>
    void res.on("prefinish", () => replaceOn(object, name, original)),
  "on the object, and the response has listeners": (object, name, original, res) => {
    for (const event of ["prefinish", "finish", "close"]) res.on(event, () => lines.push(event));
    replaceOn(object, name, original);
  },
};

const members: [of: "request" | "response", name: string, morePlaces: Record<string, Place>][] = [
  ["response", "shouldKeepAlive", {}],
  ["response", "socket", {}],
  ["response", "writableHighWaterMark", {}],
  ["response", "getHeader", { "on ServerResponse.prototype": replaceOnPrototype(ServerResponse.prototype) }],
  ["request", "readableEnded", { "on IncomingMessage.prototype": replaceOnPrototype(IncomingMessage.prototype) }],
];

const exchanges: Record<string, { body?: string; respond(req: IncomingMessage, res: ServerResponse): void }> = {
  "end(body)": { respond: (_req, res) => void res.end("ok") },
  "write(), end(body)": {
    respond(_req, res) {
      res.write("o");
      res.end("k");
    },
  },
  "a content-length, write(), end()": {
    respond(_req, res) {
      res.setHeader("content-length", 2);
      res.write("ok");
      res.end();
    },
  },
  "a body that is read, end(body)": {
    body: "hello",
    respond(req, res) {
      req.on("data", () => {});
      req.on("end", () => res.end("ok"));
    },
  },
  "a body that is ignored, end(body)": { body: "hello", respond: (_req, res) => void res.end("ok") },
};

let listener: http.RequestListener;
const server = http.createServer((req, res) => listener(req, res));
await once(server.listen(0, "127.0.0.1"), "listening");
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

async function run(title: string, exchange: (typeof exchanges)[string], replace: http.RequestListener) {
  lines = [];
  listener = (req, res) => {
    replace(req, res);
    exchange.respond(req, res);
    lines.push("the listener returns");
  };
  const response = await fetch(url, exchange.body === undefined ? {} : { method: "POST", body: exchange.body });
  const text = await response.text();
  for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve));
  restore?.();
  restore = undefined;
  console.log(`${title}: ${response.status} ${text} ${response.headers.get("connection")}`);
  console.log("    " + lines.join(" | "));
}

for (const [how, exchange] of Object.entries(exchanges)) await run(`nothing replaced, ${how}`, exchange, () => {});
for (const [of, name, morePlaces] of members) {
  for (const [where, place] of Object.entries({ ...places, ...morePlaces })) {
    for (const [how, exchange] of Object.entries(exchanges)) {
      await run(`${name} of the ${of} replaced ${where}, ${how}`, exchange, (req, res) => {
        const object = of === "request" ? req : res;
        place(object, name, Object.getOwnPropertyDescriptor(ownerOf(object, name), name)!, res);
      });
    }
  }
}

// A getter that answers otherwise than the accessor it stands for.
for (const [how, exchange] of Object.entries(exchanges)) {
  await run(`shouldKeepAlive of the response answers false, ${how}`, exchange, (_req, res) => {
    Object.defineProperty(res, "shouldKeepAlive", {
      configurable: true,
      get() {
        lines.push("get shouldKeepAlive");
        return false;
      },
    });
  });
}

// The member is replaced between write() and end().
for (const [of, name] of members) {
  for (const hasLength of [false, true]) {
    const title = `${name} of the ${of} replaced between write() and end()${hasLength ? ", behind a content-length" : ""}`;
    await run(title, { respond() {} }, (req, res) => {
      if (hasLength) res.setHeader("content-length", 2);
      res.write("ok");
      const object = of === "request" ? req : res;
      replaceOn(object, name, Object.getOwnPropertyDescriptor(ownerOf(object, name), name)!);
      res.end();
    });
  }
}

// What is stored between write() and end() comes too late for the head.
for (const hasLength of [false, true]) {
  const title = `shouldKeepAlive = false between write() and end()${hasLength ? ", behind a content-length" : ""}`;
  await run(title, { respond() {} }, (_req, res) => {
    if (hasLength) res.setHeader("content-length", 2);
    res.write("ok");
    res.shouldKeepAlive = false;
    res.end();
  });
}

server.close();
server.closeAllConnections();
