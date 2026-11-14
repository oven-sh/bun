import events, { type EventEmitter } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import stream from "node:stream";
import { RawHttpConnection, get, post } from "../raw-http-client.ts";
import {
  type Log,
  Report,
  attempt,
  formatFlags,
  formatResponse,
  formatValue,
  listen,
  readOrGiveUp,
  runProbe,
} from "./probe.ts";

interface Context {
  req: IncomingMessage & Record<string, any>;
  res: ServerResponse & Record<string, any>;
  log: Log;
  note(message: string): void;
  listen(emitter: EventEmitter, event: string, label: string): void;
  afterEnd?: () => void;
}

const preparations: Record<string, (context: Context) => unknown> = {
  "nothing": () => {},
  "one finish listener": ({ res, listen }) => listen(res, "finish", "a"),
  "three finish listeners": ({ res, listen }) => {
    listen(res, "finish", "a");
    listen(res, "finish", "b");
    listen(res, "finish", "c");
  },
  "one close listener": ({ res, listen }) => listen(res, "close", "a"),
  "finish and close listeners": ({ res, listen }) => {
    listen(res, "finish", "a");
    listen(res, "close", "a");
  },
  "prependListener(finish)": ({ res, listen, note }) => {
    listen(res, "finish", "a");
    res.prependListener("finish", () => note("res finish, prepended"));
  },
  "prependOnceListener(finish)": ({ res, note }) =>
    res.prependOnceListener("finish", () => note("res finish, prepended")),
  "prependListener(close)": ({ res, note }) => res.prependListener("close", () => note("res close, prepended")),
  "once()": ({ res, note }) => {
    res.once("finish", () => note("res finish, once a"));
    res.once("finish", () => note("res finish, once b"));
    res.once("close", () => note("res close, once"));
  },
  "the same function twice": ({ res, log }) => {
    const listener = () => log("res finish, the same function");
    res.on("finish", listener);
    res.on("finish", listener);
  },
  "events.once()": ({ res, note }) => {
    events.once(res, "finish").then(() => note("events.once(finish)"));
    events.once(res, "close").then(() => note("events.once(close)"));
  },
  "stream.finished(res)": ({ res, note }) =>
    stream.finished(res, error => note("finished " + formatValue(error?.code))),
  "stream.promises.finished(res)": ({ res, note }) => {
    stream.promises.finished(res).then(
      () => note("finished"),
      error => note("finished rejects " + error.code),
    );
  },
  "stream.finished(req)": ({ req, note }) =>
    stream.finished(req, error => note("finished " + formatValue(error?.code))),
  "counts the listeners": ({ res, log }) =>
    log(res.eventNames().map(String), res.listenerCount("finish"), res.rawListeners("finish").length),
  "removes the listeners that are already there": ({ res, listen }) => {
    for (const listener of res.listeners("finish")) res.removeListener("finish", listener as () => void);
    listen(res, "finish", "a");
  },
  "moves the listeners that are already there to the end": ({ res, listen }) => {
    const existing = res.listeners("finish");
    res.removeAllListeners("finish");
    listen(res, "finish", "a");
    for (const listener of existing) res.on("finish", listener as () => void);
    listen(res, "finish", "b");
  },
  "calls the first listener directly": ({ res, listen, log }) => {
    listen(res, "finish", "a");
    for (const listener of res.listeners("finish").slice(0, 1)) log(attempt(() => listener.call(res)));
  },
  "emit(finish)": ({ res, listen, log }) => {
    listen(res, "finish", "a");
    listen(res, "close", "a");
    log(attempt(() => res.emit("finish")));
  },
  "emit(prefinish)": ({ res, listen, log }) => {
    listen(res, "prefinish", "a");
    log(attempt(() => res.emit("prefinish")));
  },
  "emit(close)": ({ res, listen, log }) => {
    listen(res, "finish", "a");
    listen(res, "close", "a");
    log(attempt(() => res.emit("close")));
  },
  "emit(finish) without listeners": ({ res, log }) => log(attempt(() => res.emit("finish"))),
  "emit(error)": ({ res, log }) => {
    res.on("error", error => log("res error " + error.message));
    log(attempt(() => res.emit("error", new Error("emitted by the test"))));
  },
  "newListener and removeListener on res": ({ res, log }) => {
    res.on("newListener", event => log("res newListener " + String(event)));
    res.on("removeListener", event => log("res removeListener " + String(event)));
  },
  "newListener and removeListener on req": ({ req, log }) => {
    req.on("newListener", event => log("req newListener " + String(event)));
    req.on("removeListener", event => log("req removeListener " + String(event)));
  },
  "setMaxListeners(1)": ({ res, listen }) => {
    res.setMaxListeners(1);
    listen(res, "finish", "a");
    listen(res, "finish", "b");
  },
  "appends to _events.finish": ({ res, note }) => {
    res._events.finish = [].concat(res._events.finish || [], (() => note("res finish, appended to _events")) as any);
  },
  "prepends to _events.finish": ({ res, note }) => {
    res._events.finish = [() => note("res finish, prepended to _events")].concat(res._events.finish || []);
  },
  "replaces _events.finish": ({ res, note }) => {
    res._events.finish = () => note("res finish, alone in _events");
  },
  "replaces _events": ({ res, note }) => {
    res._events = { __proto__: null, finish: () => note("res finish, in a new _events") };
    res._eventsCount = 1;
  },
  "errorMonitor": ({ res, log }) => res.on(events.errorMonitor, error => log("errorMonitor " + error.message)),
  "async finish listener": ({ res, note }) =>
    res.on("finish", async () => {
      note("async listener, before await");
      await null;
      note("async listener, after await");
    }),
  "async finish listener that throws": ({ res }) =>
    res.on("finish", async () => {
      throw new Error("thrown by an async listener");
    }),
  "prefinish listener that calls end()": ({ res, log }) =>
    res.on("prefinish", () => log(attempt(() => res.end() === res))),
  "every event of req": ({ req, note }) => {
    for (const event of ["end", "close", "data", "readable", "pause", "resume", "error"]) {
      req.on(event, () => note("req " + event));
    }
  },
  "finish, close and end listeners, req.resume()": ({ req, res, listen }) => {
    listen(res, "finish", "a");
    listen(res, "close", "a");
    listen(req, "end", "a");
    listen(req, "close", "a");
    req.resume();
  },
  "socket listeners": ({ req, res, listen, log }) => {
    listen(res, "finish", "a");
    for (const event of ["drain", "finish", "timeout"]) req.socket.once(event, () => log("socket " + event));
  },
  "adds listeners after end()": context => {
    context.afterEnd = () => {
      context.listen(context.res, "finish", "late");
      context.listen(context.res, "close", "late");
      context.res.prependListener("finish", () => context.log("res finish, prepended after end()"));
    };
  },
  "removeAllListeners(finish) after end()": context => {
    context.listen(context.res, "finish", "a");
    context.afterEnd = () => context.res.removeAllListeners("finish");
  },
  "removes the first finish listener after end()": context => {
    context.listen(context.res, "finish", "a");
    context.afterEnd = () => context.res.removeListener("finish", context.res.listeners("finish")[0] as () => void);
  },
};

const requestFlags = ["complete", "readableEnded", "destroyed", "closed"];
const responseFlags = ["finished", "writableFinished", "destroyed", "closed"];

function describeState(req: IncomingMessage, res: ServerResponse) {
  const socket = req.socket as any;
  const message = socket?._httpMessage === res ? "res" : formatValue(socket?._httpMessage);
  return (
    `req[${formatFlags(req, requestFlags)}] ` +
    `res[${formatFlags(res, responseFlags)} socket=${res.socket ? "set" : formatValue(res.socket)}] message=${message}`
  );
}

const [ownTicks = "no-ticks", body = "none", filter = ""] = process.argv.slice(2);

const report = new Report();
let prepare: (context: Context) => unknown;
let responder = "";
let noteAfterResponse: (() => void) | undefined;

function handle(req: IncomingMessage, res: ServerResponse) {
  const log = report.current;
  let lastState = "";
  const note = (message: string) => {
    log(message);
    const state = describeState(req, res);
    if (state !== lastState) log("  " + state);
    lastState = state;
  };
  const context: Context = {
    req,
    res,
    log,
    note,
    listen: (emitter, event, label) =>
      emitter.on(event, () => note(`${emitter === res ? "res" : "req"} ${event} ${label}`)),
  };
  noteAfterResponse = () => {
    note("after the response");
    log("event names", res.eventNames().map(String), req.eventNames().map(String));
  };
  log(
    "prepare:",
    attempt(() => (prepare(context), "done")),
  );
  if (ownTicks === "ticks") process.nextTick(() => note("tick queued before end()"));
  log(
    "respond:",
    attempt(() => {
      if (responder !== "end(body)") res.write("o");
      res.end(responder === "end(body)" ? "ok" : "k", () => note("end() callback"));
      return "done";
    }),
  );
  if (context.afterEnd)
    log(
      "after end():",
      attempt(() => (context.afterEnd!(), "done")),
    );
  if (ownTicks === "ticks") process.nextTick(() => note("tick queued after end()"));
  queueMicrotask(() => note("microtask queued after end()"));
  setImmediate(() => note("immediate"));
}

const server = http.createServer((req, res) => {
  if (body === "none") return handle(req, res);
  const onData = () => {};
  const onEnd = () => {
    req.removeListener("data", onData);
    req.removeListener("end", onEnd);
    handle(req, res);
  };
  req.on("data", onData);
  req.on("end", onEnd);
});

runProbe(async () => {
  report.recordUncaughtErrors();
  process.on("warning", warning => report.current("warning", warning.name, warning.message.slice(0, 90)));
  const port = await listen(server);
  const request = body === "none" ? get("/") : post("/", "hello");

  for (const [name, preparation] of Object.entries(preparations)) {
    for (const currentResponder of ["end(body)", "write(), end(body)"]) {
      if (!name.includes(filter)) continue;
      prepare = preparation;
      responder = currentResponder;
      const log = report.start(`${name}, ${currentResponder}`);
      using connection = await RawHttpConnection.connect(port);
      for (let i = 0; i < 3; i++) {
        report.startBlock();
        noteAfterResponse = undefined;
        connection.send(request);
        const response = await readOrGiveUp(connection);
        log("response:", formatResponse(response));
        (noteAfterResponse as (() => void) | undefined)?.();
        if (response.startsWith("closed") || response === "no response") break;
      }
    }
  }

  server.close();
  server.closeAllConnections();
  report.print();
});
