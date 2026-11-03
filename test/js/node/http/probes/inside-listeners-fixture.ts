import type { EventEmitter } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { RawHttpConnection, get, post } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  ReusedConnection,
  attempt,
  formatFlags,
  formatResponse,
  formatValue,
  listen,
  readOrGiveUp,
  runProbe,
  untilDestroyed,
} from "./probe.ts";

interface Context {
  req: IncomingMessage & Record<string, any>;
  res: ServerResponse & Record<string, any>;
  log: Log;
  note(message: string): void;
  emitter?: EventEmitter;
  event?: string;
  actor?: () => unknown;
  lastObserver?: () => void;
}

let heldResponse: ServerResponse | undefined;
let onHeld: (() => void) | undefined;

const actions: Record<string, (context: Context) => unknown> = {
  "does nothing": () => {},
  "queues three nested ticks": ({ note }) =>
    process.nextTick(() => {
      note("tick 1");
      process.nextTick(() => {
        note("tick 2");
        process.nextTick(() => note("tick 3"));
      });
    }),
  "queues microtasks": ({ note }) => {
    queueMicrotask(() => {
      note("microtask 1");
      queueMicrotask(() => note("microtask 2"));
    });
    Promise.resolve().then(() => note("promise reaction"));
  },
  "queues a tick from a microtask": ({ note }) => queueMicrotask(() => process.nextTick(() => note("tick"))),
  "queues a microtask from a tick": ({ note }) => process.nextTick(() => queueMicrotask(() => note("microtask"))),
  "queues an immediate": ({ note }) => setImmediate(() => note("immediate")),
  "queues a tick, a microtask, an immediate and awaits": ({ note }) => {
    process.nextTick(() => note("tick"));
    queueMicrotask(() => note("microtask"));
    setImmediate(() => note("immediate"));
    (async () => {
      await null;
      note("first await");
      await null;
      note("second await");
    })();
  },
  "adds a listener for the same event": ({ emitter, event, log }) => emitter?.on(event!, () => log("added listener")),
  "adds listeners for later events": ({ req, res, log }) => {
    for (const event of ["finish", "close"]) res.on(event, () => log("added: res " + event));
    for (const event of ["end", "close"]) req.on(event, () => log("added: req " + event));
  },
  "prepends listeners for later events": ({ req, res, log }) => {
    for (const event of ["finish", "close"]) res.prependListener(event, () => log("prepended: res " + event));
    for (const event of ["end", "close"]) req.prependListener(event, () => log("prepended: req " + event));
  },
  "adds once() listeners for close": ({ req, res, log }) => {
    res.once("close", () => log("once: res close"));
    req.once("close", () => log("once: req close"));
  },
  "removes itself": ({ emitter, event, actor }) => emitter?.removeListener(event!, actor!),
  "removes the listener after it": ({ emitter, event, lastObserver }) => emitter?.removeListener(event!, lastObserver!),
  "removes every listener of the event": ({ emitter, event }) => emitter?.removeAllListeners(event),
  "removes every listener of res": ({ res }) => res.removeAllListeners(),
  "removes every listener of req": ({ req }) => req.removeAllListeners(),
  "removes the close listeners": ({ req, res }) => {
    res.removeAllListeners("close");
    req.removeAllListeners("close");
  },
  "throws": () => {
    throw new Error("thrown inside a listener");
  },
  "returns a rejected promise": () => Promise.reject(new Error("rejected inside a listener")),
  "calls res.destroy()": ({ res, log }) => log(attempt(() => res.destroy() === res)),
  "calls res.destroy(error)": ({ res, log }) => log(attempt(() => res.destroy(new Error("destroyed")) === res)),
  "calls req.destroy()": ({ req, log }) => log(attempt(() => req.destroy() === req)),
  "calls socket.destroy()": ({ req, log }) => log(attempt(() => !!req.socket.destroy())),
  "calls socket.end()": ({ req, log }) => log(attempt(() => !!req.socket.end())),
  "calls res.end() again": ({ res, log }) => log(attempt(() => res.end("again") === res)),
  "calls res.end(callback) again": ({ res, log }) =>
    log(attempt(() => res.end(() => log("second end() callback")) === res)),
  "calls res.write() again": ({ res, log }) =>
    log(attempt(() => res.write("again", (error: any) => log("late write() callback " + formatValue(error?.code))))),
  "calls res.setHeader()": ({ res, log }) =>
    log(
      attempt(() => (res.setHeader("x-late", "1"), "set")),
      attempt(() => res.getHeader("x-late")),
      attempt(() => res.headersSent),
    ),
  "calls req.resume()": ({ req, log }) => log(attempt(() => req.resume() === req)),
  "calls req.read()": ({ req, log }) => log(attempt(() => req.read())),
  "adds a data listener": ({ req, log }) => req.on("data", (chunk: Buffer) => log("req data " + chunk.length)),
  "calls req.pause()": ({ req, log }) => log(attempt(() => req.pause() === req)),
  "calls server.closeIdleConnections()": ({ log }) => log(attempt(() => server.closeIdleConnections())),
  "calls socket.setTimeout()": ({ req, log }) =>
    log(
      attempt(() => !!req.socket.setTimeout(40000)),
      req.socket.timeout,
    ),
  "replaces emit() on req and res": ({ req, res, log }) => {
    const responseEmit = res.emit;
    res.emit = function (event: string) {
      log("res.emit " + String(event));
      return responseEmit.apply(this, arguments as any);
    } as any;
    const requestEmit = req.emit;
    req.emit = function (event: string) {
      log("req.emit " + String(event));
      return requestEmit.apply(this, arguments as any);
    } as any;
  },
  "ends a response held on another connection": ({ log }) => {
    const held = heldResponse;
    heldResponse = undefined;
    log(held ? attempt(() => held.end("held") === held) : "no response is held");
  },
  "clears res.req and req.res": ({ req, res }) => {
    (res as any).req = null;
    req.res = null;
  },
};

const places = [
  "res prefinish",
  "res finish",
  "res close",
  "req end",
  "req close",
  "end() callback",
  "write() callback",
];

const requestFlags = ["complete", "readableEnded", "destroyed", "closed", "_dumped", "readableFlowing"];
const responseFlags = ["finished", "writableFinished", "destroyed", "closed"];

function describeState(req: IncomingMessage, res: ServerResponse) {
  const socket = req.socket as any;
  const message = socket?._httpMessage === res ? "res" : formatValue(socket?._httpMessage);
  const incoming = socket?.parser?.incoming === req ? "req" : formatValue(socket?.parser?.incoming);
  const listenerCounts = `${res.listenerCount("finish")},${res.listenerCount("close")}`;
  return (
    `req[${formatFlags(req, requestFlags)}] ` +
    `res[${formatFlags(res, responseFlags)} socket=${res.socket ? "set" : formatValue(res.socket)} listeners=${listenerCounts}] ` +
    `socket[message=${message} incoming=${incoming} destroyed=${socket?.destroyed}]`
  );
}

const [observers = "all", body = "none", filter = ""] = process.argv.slice(2);

const report = new Report();
report.recordUncaughtErrors();

let place = "";
let action: (context: Context) => unknown;
let responder = "";
let exchange: { note(message: string): void; socket: Socket } | undefined;

function handle(req: IncomingMessage, res: ServerResponse) {
  const log = report.current;
  let lastState = "";
  const note = (message: string) => {
    log(message);
    const state = describeState(req, res);
    if (state !== lastState) log("  " + state);
    lastState = state;
  };
  exchange = { note, socket: req.socket };

  const [emitterName, event] = place.split(" ");
  const emitter = emitterName === "res" ? res : emitterName === "req" ? req : undefined;
  const context: Context = { req, res, log, note, emitter, event };
  const act = () => {
    note(`${place}: the action runs`);
    return action(context);
  };
  const observed: [string, EventEmitter, string[]][] = [
    ["res", res, ["prefinish", "finish", "close", "error"]],
    ["req", req, ["end", "close", "error", "aborted"]],
  ];
  for (const [name, target, events] of observed) {
    for (const observedEvent of events) {
      if (target === emitter && observedEvent === event) {
        target.on(observedEvent, () => log(`${name} ${observedEvent}: first listener`));
        context.actor = act;
        target.on(observedEvent, act);
        context.lastObserver = () => log(`${name} ${observedEvent}: last listener`);
        target.on(observedEvent, context.lastObserver);
      } else if (observers === "all" || (observers === "response" && name === "res")) {
        target.on(observedEvent, (error?: any) =>
          log(`${name} ${observedEvent}` + (error instanceof Error ? " " + (error as any).code : "")),
        );
      }
    }
  }
  if (body === "none" && place === "req end") req.resume();

  const callbackFor = (method: string) =>
    place === method + " callback"
      ? (error?: any) => {
          if (error) log(`${method} callback received ${error.code}`);
          return act();
        }
      : undefined;
  note("the request listener runs");
  if (responder === "end(body)") {
    res.end("ok", callbackFor("end()"));
  } else {
    res.write("o", callbackFor("write()"));
    res.end("k", callbackFor("end()"));
  }
  note("after end()");
}

function afterBody(req: IncomingMessage, run: () => void) {
  if (body === "data") {
    req.on("data", () => {});
    req.on("end", run);
  } else if (body === "removed") {
    const onData = () => {};
    const onEnd = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      run();
    };
    req.on("data", onData);
    req.on("end", onEnd);
  } else if (body === "resume") {
    req.resume();
    req.once("end", run);
  } else if (body === "await") {
    (async () => {
      for await (const chunk of req);
      run();
    })();
  } else {
    run();
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/warm-up") return void res.end("ok");
  if (req.url === "/hold") {
    heldResponse = res;
    onHeld?.();
    return;
  }
  afterBody(req, () => handle(req, res));
});

function forgetExchange() {
  exchange = undefined;
}

function lastSocket() {
  return exchange?.socket;
}

function noteAfterResponse() {
  exchange?.note("after the response");
}

runProbe(async () => {
  const port = await listen(server);
  const request = body === "none" ? get("/") : post("/", "hello");
  const reused = new ReusedConnection(port);

  for (const currentPlace of places) {
    for (const [actionName, currentAction] of Object.entries(actions)) {
      for (const currentResponder of currentPlace === "write() callback"
        ? ["write(), end(body)"]
        : ["end(body)", "write(), end(body)"]) {
        const name = `${currentPlace}: ${actionName}, ${currentResponder}`;
        if (!name.includes(filter)) continue;
        place = currentPlace;
        action = currentAction;
        responder = currentResponder;
        forgetExchange();
        const log = report.start(name);

        const holdsResponse = actionName === "ends a response held on another connection";
        using holding = holdsResponse ? await RawHttpConnection.connect(port) : undefined;
        if (holding) {
          const held = new Promise<void>(resolve => (onHeld = resolve));
          holding.send(get("/hold"));
          await held;
        }
        const connection = await reused.acquire();
        for (let i = 0; i < (holdsResponse ? 1 : 3); i++) {
          report.startBlock();
          connection.send(request);
          const response = await readOrGiveUp(connection);
          log("response:", formatResponse(response));
          noteAfterResponse();
          if (response.startsWith("closed") || response === "no response") break;
        }
        report.startBlock();
        if (holding && heldResponse) log("the held response was never ended");
        else if (holding) log("held response:", formatResponse(await readOrGiveUp(holding)));
        heldResponse = undefined;
        if (/socket|closeIdleConnections/.test(actionName)) {
          reused.discard();
          await untilDestroyed(lastSocket());
        } else {
          log("the connection serves another request:", await reused.release());
        }
      }
    }
  }

  reused.discard();
  server.close();
  server.closeAllConnections();
  report.print();
});
