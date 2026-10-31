import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { get, post } from "../raw-http-client.ts";
import {
  Report,
  ReusedConnection,
  formatResponse,
  formatValue,
  listen,
  readOrGiveUp,
  runProbe,
  untilDestroyed,
} from "./probe.ts";

const exchanges: Record<string, { request: string; respond(req: IncomingMessage, res: ServerResponse): void }> = {
  "GET, end(body)": { request: get("/"), respond: (req, res) => void res.end("ok") },
  "GET, write(), end(body)": {
    request: get("/"),
    respond(req, res) {
      res.write("o");
      res.end("k");
    },
  },
  "POST with the body read": {
    request: post("/", "hello"),
    respond(req, res) {
      req.on("data", () => {});
      req.on("end", () => res.end("ok"));
    },
  },
  "POST with the body ignored": { request: post("/", "hello"), respond: (req, res) => void res.end("ok") },
};

const [target = "socket", filter = ""] = process.argv.slice(2);

const report = new Report();
report.recordUncaughtErrors();

let current: { socket?: Socket; req?: IncomingMessage; res?: ServerResponse } = {};
let respond: (req: IncomingMessage, res: ServerResponse) => void;
let onWarmUp: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
let beforeResponding: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;

function record(receiver: unknown, name: string, args: unknown[]) {
  const who =
    receiver === current.socket
      ? "socket"
      : receiver === current.req
        ? "req"
        : receiver === current.res
          ? "res"
          : target === "server" && receiver === server
            ? "server"
            : "";
  if (!who) return;
  const argument = typeof args[0] === "object" || typeof args[0] === "function" ? typeof args[0] : formatValue(args[0]);
  report.current(`${who}.${name}(${args.length ? argument : ""})`);
}

function replace(holder: any, name: string) {
  const own = Object.getOwnPropertyDescriptor(holder, name);
  if (own && !own.configurable) return undefined;
  let owner = holder;
  while (owner && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, name)!;
  if (!descriptor) return undefined;
  if (descriptor.get) {
    Object.defineProperty(holder, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        record(this, "get " + name, []);
        return descriptor.get!.call(this);
      },
      set(value) {
        record(this, "set " + name, [value]);
        descriptor.set?.call(this, value);
      },
    });
  } else if (typeof descriptor.value === "function") {
    const original = descriptor.value;
    Object.defineProperty(holder, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: true,
      value: function (this: unknown, ...args: unknown[]) {
        record(this, name, args);
        return original.apply(this, args);
      },
    });
  } else {
    return undefined;
  }
  return () => void (own ? Object.defineProperty(holder, name, own) : delete holder[name]);
}

const server = http.createServer((req, res) => {
  if (req.url === "/warm-up") {
    current = { socket: req.socket };
    res.end("ok");
    onWarmUp?.(req, res);
    onWarmUp = undefined;
    return;
  }
  current = { socket: req.socket, req, res };
  beforeResponding?.(req, res);
  respond(req, res);
});

function prototypeChain(object: object) {
  const chain: object[] = [];
  for (let level = Object.getPrototypeOf(object); level && level !== Object.prototype;) {
    chain.push(level);
    level = Object.getPrototypeOf(level);
  }
  return chain;
}

function methodAndAccessorNames(level: object, isReplacedInPlace: boolean) {
  return Object.getOwnPropertyNames(level).filter(name => {
    const descriptor = Object.getOwnPropertyDescriptor(level, name)!;
    if (name === "constructor" || (isReplacedInPlace && !descriptor.configurable)) return false;
    return descriptor.get !== undefined || typeof descriptor.value === "function";
  });
}

runProbe(async () => {
  const port = await listen(server);
  const reused = new ReusedConnection(port);

  const seen = new Promise<object>(resolve => {
    onWarmUp = (req, res) => resolve({ socket: req.socket, request: req, response: res, server }[target]!);
  });
  await reused.acquire();
  const chain = prototypeChain(await seen);
  const inheritedNames = [...new Set(chain.flatMap(level => methodAndAccessorNames(level, false)))];
  const levels: [string, object | undefined, string[]][] = [
    [`the ${target}`, undefined, inheritedNames],
    ...chain.map((level): [string, object, string[]] => [
      level.constructor.name + ".prototype",
      level,
      methodAndAccessorNames(level, true),
    ]),
  ];

  for (const [levelName, level, names] of levels) {
    for (const name of names) {
      for (const [exchangeName, exchange] of Object.entries(exchanges)) {
        const caseName = `${name} replaced on ${levelName}, ${exchangeName}`;
        if (!caseName.includes(filter)) continue;
        respond = exchange.respond;
        const log = report.start(caseName);
        const replacesOnSocket = !level && target === "socket";
        let restore: (() => void) | undefined;
        if (replacesOnSocket) {
          reused.discard();
          onWarmUp = req => void replace(req.socket, name);
        } else if (!level && target !== "server") {
          beforeResponding = (req, res) => void replace(target === "request" ? req : res, name);
        }
        const connection = await reused.acquire();
        if (level || target === "server") restore = replace(level ?? server, name);
        for (let i = 0; i < 3; i++) {
          report.startBlock();
          connection.send(exchange.request);
          const response = await readOrGiveUp(connection);
          log("response:", formatResponse(response));
          if (response.startsWith("closed") || response === "no response") break;
        }
        report.startBlock();
        restore?.();
        beforeResponding = undefined;
        if (replacesOnSocket) {
          reused.discard();
          await untilDestroyed(current.socket);
        } else {
          current = {};
          log("the connection serves another request:", await reused.release());
        }
        current = {};
      }
    }
  }

  reused.discard();
  server.close();
  server.closeAllConnections();
  report.print();
});
