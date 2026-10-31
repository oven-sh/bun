import { expect, test } from "bun:test";
import asyncHooks from "node:async_hooks";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { Readable } from "node:stream";

const kState = Object.getOwnPropertySymbols(new Readable()._readableState).find(s => s.description === "kState")!;

type Log = (text: string) => void;
type Scene = (req: http.IncomingMessage, res: http.ServerResponse, log: Log) => void;

function look(req: http.IncomingMessage) {
  const state = (req as any)._readableState;
  return [
    state[kState],
    state.length,
    state.buffer.length,
    req.complete,
    req.destroyed,
    req.closed,
    req.readableFlowing,
    req.readableEnded,
    req.readableDidRead,
    (req as any)._consuming,
    (req as any)._dumped,
    req.aborted,
    req.socket ? (req.socket as any).parser?.incoming === req : "no socket",
    req.socket ? req.socket.readableFlowing : "-",
    req.eventNames().map(String).join("+"),
  ].join(" ");
}

function sampleTicks(req: http.IncomingMessage, log: Log, label: string, count: number) {
  let n = 0;
  (function tick() {
    log(`${label} tick ${n} ${look(req)}`);
    if (++n < count) process.nextTick(tick);
  })();
}

function sampleJobs(req: http.IncomingMessage, log: Log, count: number) {
  let n = 0;
  (function job() {
    log(`job ${n} ${look(req)}`);
    if (++n < count) Promise.resolve().then(job);
  })();
}

function hear(req: http.IncomingMessage, log: Log, names: string[]) {
  for (const name of names) {
    req.on(name, value =>
      log(`${name} ${value === undefined ? "" : typeof value + ":" + String(value).length} ${look(req)}`),
    );
  }
}

const asText: Scene = (req, res, log) => {
  req.setEncoding("utf8");
  let body = "";
  function onData(chunk: string) {
    log(`data ${typeof chunk} ${chunk.length} ${look(req)}`);
    body += chunk;
  }
  function onEnd(error?: Error) {
    log(`end ${error} ${look(req)}`);
    req.removeListener("data", onData);
    req.removeListener("end", onEnd);
    req.removeListener("error", onEnd);
    log(`removed ${look(req)}`);
    res.end(String(body.length));
  }
  req.on("data", onData);
  req.on("end", onEnd);
  req.on("error", onEnd);
  req.resume();
  log(`asked ${look(req)}`);
};

const asBytes: Scene = (req, res, log) => {
  const chunks: Buffer[] = [];
  const names = ["aborted", "close", "data", "end", "error"];
  const listeners: Record<string, (value?: any) => void> = {
    aborted: () => log("aborted"),
    close: () => log(`close ${look(req)}`),
    data: chunk => {
      log(`data ${chunk.length} ${look(req)}`);
      chunks.push(chunk);
    },
    end: () => {
      log(`end ${look(req)}`);
      for (const name of names) req.removeListener(name, listeners[name]);
      res.end(String(Buffer.concat(chunks).length));
    },
    error: error => log(`error ${error}`),
  };
  for (const name of names) req.on(name, listeners[name]);
};

function wrap(req: any, log: Log, name: string) {
  const original = req[name];
  req[name] = function (first: unknown) {
    log(
      `${name} ${first === null || typeof first !== "object" ? String(first) : (first as Buffer).length} ${look(req)}`,
    );
    return original.apply(this, arguments);
  };
}

const scenes: Record<string, Scene> = {
  asText,
  asBytes,
  everyEvent(req, res, log) {
    hear(req, log, ["resume", "pause", "data", "end", "close", "error", "aborted"]);
    req.on("end", () => res.end("ok"));
  },
  closeHeard(req, res, log) {
    hear(req, log, ["data", "end", "close"]);
    req.on("end", () => res.end("ok"));
  },
  ticksFromTheHandler(req, res, log) {
    asText(req, res, log);
    sampleTicks(req, log, "handler", 14);
  },
  ticksFromTheListeners(req, res, log) {
    req.on("data", () => sampleTicks(req, log, "data", 10));
    req.on("end", () => {
      sampleTicks(req, log, "end", 8);
      res.end("ok");
    });
  },
  jobs(req, res, log) {
    asBytes(req, res, log);
    sampleJobs(req, log, 12);
  },
  destroyInData(req, res, log) {
    hear(req, log, ["data", "end", "close", "error", "aborted"]);
    req.once("data", () => {
      res.end("ok");
      req.destroy();
      log(`destroyed ${look(req)}`);
    });
    req.on("end", () => void (res.writableEnded || res.end("ok")));
  },
  ownPush(req, res, log) {
    wrap(req, log, "push");
    asText(req, res, log);
  },
  ownRead(req, res, log) {
    wrap(req, log, "read");
    asBytes(req, res, log);
  },
  ownInnerRead(req, res, log) {
    wrap(req, log, "_read");
    asBytes(req, res, log);
  },
  ownEmit(req, res, log) {
    wrap(req, log, "emit");
    asText(req, res, log);
  },
  ownDestroy(req, res, log) {
    wrap(req, log, "destroy");
    wrap(req, log, "_destroy");
    asText(req, res, log);
  },
  inTheNextJob(req, res, log) {
    Promise.resolve().then(() => asBytes(req, res, log));
  },
  inTheNextTick(req, res, log) {
    process.nextTick(() => asBytes(req, res, log));
  },
  async iterate(req, res, log) {
    let length = 0;
    for await (const chunk of req) {
      log(`chunk ${chunk.length} ${look(req)}`);
      length += chunk.length;
    }
    log(`done ${look(req)}`);
    res.end(String(length));
  },
  readable(req, res, log) {
    req.on("readable", () => {
      let chunk;
      log(`readable ${look(req)}`);
      while ((chunk = req.read()) !== null) log(`read ${chunk.length} ${look(req)}`);
    });
    req.on("end", () => {
      log(`end ${look(req)}`);
      res.end("ok");
    });
  },
  pipe(req, res, log) {
    hear(req, log, ["end", "close"]);
    req.pipe(res);
  },
  unread(req, res, log) {
    hear(req, log, ["end", "close"]);
    res.end("ok");
    sampleTicks(req, log, "handler", 12);
  },
  socketHeard(req, res, log) {
    const socket = req.socket;
    const onResume = () => log(`socket resume ${look(req)}`);
    const onPause = () => log(`socket pause ${look(req)}`);
    socket.on("resume", onResume);
    socket.on("pause", onPause);
    res.on("close", () => {
      socket.removeListener("resume", onResume);
      socket.removeListener("pause", onPause);
    });
    asText(req, res, log);
  },
};

const head = "POST /x HTTP/1.1\r\nHost: a\r\n";
const bodies: Record<string, string | Buffer> = {
  whole: head + "Content-Length: 11\r\n\r\nhello world",
  chunked: head + "Transfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n",
  trailers: head + "Transfer-Encoding: chunked\r\nTrailer: x-t\r\n\r\nb\r\nhello world\r\n0\r\nx-t: 1\r\n\r\n",
  halfCharacter: Buffer.concat([Buffer.from(head + "Content-Length: 4\r\n\r\nab"), Buffer.from([0xe2, 0x82])]),
  onlyHalfCharacter: Buffer.concat([Buffer.from(head + "Content-Length: 1\r\n\r\n"), Buffer.from([0xe2])]),
  empty: head + "Content-Length: 0\r\n\r\n",
};

function isWhole(answer: string) {
  const headEnd = answer.indexOf("\r\n\r\n");
  if (headEnd < 0) return false;
  const length = /^content-length: *(\d+)/im.exec(answer.slice(0, headEnd));
  return length ? answer.length >= headEnd + 4 + Number(length[1]) : answer.endsWith("\r\n0\r\n\r\n");
}

async function record(
  port: number,
  setScene: (scene: http.RequestListener) => void,
  scene: Scene,
  body: string | Buffer,
) {
  const lines: string[] = [];
  const log: Log = text => void lines.push(text);
  const { promise, resolve } = Promise.withResolvers<void>();
  let answer = "";
  let isServerDone = false;
  // The answer may arrive after the server is done with it: the loopback interface does not deliver at once on every system.
  const leaveWhenAnswered = () => void (isServerDone && isWhole(answer) && socket.destroy());
  setScene((req, res) => {
    log(`begins ${look(req)}`);
    res.on("close", () => {
      log(`response closed ${look(req)}`);
      setImmediate(() =>
        setImmediate(() => {
          isServerDone = true;
          leaveWhenAnswered();
        }),
      );
    });
    scene(req, res, log);
  });
  const socket = net.connect(port, "127.0.0.1", () => socket.write(body));
  socket.on("data", chunk => {
    answer += chunk;
    leaveWhenAnswered();
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    log(`answered ${answer.split("\r\n")[0]} ${answer.split("\r\n\r\n")[1]?.length}`);
    setImmediate(resolve);
  });
  await promise;
  return lines;
}

test("the order in which a request's body arrives does not depend on whether anybody watches the ticks", async () => {
  let current: http.RequestListener = () => {};
  const server = http.createServer((req, res) => current(req, res));
  const { promise: listening, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await listening;
  const port = (server.address() as AddressInfo).port;
  const hook = asyncHooks.createHook({ init() {} });
  try {
    for (const [sceneName, scene] of Object.entries(scenes)) {
      for (const [bodyName, body] of Object.entries(bodies)) {
        const unwatched = await record(port, listener => void (current = listener), scene, body);
        hook.enable();
        let watched: string[];
        try {
          watched = await record(port, listener => void (current = listener), scene, body);
        } finally {
          hook.disable();
        }
        expect({ scene: sceneName, body: bodyName, lines: unwatched }).toEqual({
          scene: sceneName,
          body: bodyName,
          lines: watched,
        });
        expect(unwatched.length).toBeGreaterThan(2);
      }
    }
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
