"use strict";
// Probe: a generated matrix of Http2Stream.close(code) / destroy() calls against a raw HTTP/2
// peer. Prints one JSON line per cell, in a fixed order. Runs unchanged under Node.js and Bun.
//
//   <runtime> gen.cjs [--filter=<substr>] [--concurrency=N] [--list] [--timeout=ms]
//
//   --filter       only the cells whose id has the substring
//   --concurrency  cells that run at once (default 16)
//   --list         print the cell ids and stop
//   --timeout      per cell, in ms (default 4000)
//
// Cell id: role|site|read|own|call. The tables under "The matrix" say what each part means.
//
// A line: {"id", "pre", "post", "ev", "wu", "st"}
//   pre   what the peer has after the call, once the wire is quiet
//   post  the same after the peer opened the stream window and the connection window
//         Both are the wire of stream 1 ("H", "HE", "D<bytes>", "D<bytes>E", "R<code>"), then
//         " G<code>" after a GOAWAY, then " X" once the socket closed.
//   ev    the events of the stream under test from the call on ("error:<code>" for 'error',
//         "throw:<code>" when the call itself threw)
//   wu    how many WINDOW_UPDATE frames the endpoint under test sent for stream 1
//   st    destroyed/closed/rstCode of the stream at the end
// and only when they apply:
//   status    "timeout" or "error:<message>": the cell gave up. "wire" is then the peer's view
//             at that moment.
//   nocall    true: the trigger of the call never fired, the call was not made
//   uncaught  the code or message of an exception nobody caught while the cell ran
//   early     'immediate' cells only: events between the peer's write and the call. The session
//             read the frames before the call, so the cell is not what its id says.
// A summary goes to stderr. DM_PROBE_MS=1 adds "ms" (duration) to every line.
const http2 = require("node:http2");
const net = require("node:net");
const { once } = require("node:events");

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
// The initial flow-control window of a stream and of the connection (RFC 9113 section 6.9.2).
const WINDOW = 65535;
const BODY = Buffer.alloc(4 * 65536, "b");
// What the peer has of a stream whose BODY is stuck: its HEADERS and one window of DATA.
const STALLED = `H D${WINDOW}`;

function frameOf(type, flags, streamId, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}
function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
// WINDOW_UPDATE with room for all of BODY.
const windowUpdate = streamId => frameOf(8, 0, streamId, u32(BODY.length));
// SETTINGS with one parameter: 3 is MAX_CONCURRENT_STREAMS, 4 is INITIAL_WINDOW_SIZE.
const settings = (id, value) => frameOf(4, 0, 0, Buffer.concat([Buffer.from([0, id]), u32(value)]));
// HEADERS with ":status: 200" (0x88 in the HPACK static table).
const responseHeaders = (streamId, endStream = false) =>
  frameOf(1, endStream ? 0x5 : 0x4, streamId, Buffer.from([0x88]));
const dataFrame = (streamId, bytes, endStream = false) =>
  frameOf(0, endStream ? 0x1 : 0, streamId, Buffer.alloc(bytes, "d"));
// HEADERS on stream 1 with END_STREAM and END_HEADERS: a literal header "x-t: 1".
const trailersFrame = () => frameOf(1, 0x5, 1, Buffer.from([0x00, 0x03, 0x78, 0x2d, 0x74, 0x01, 0x31]));

const noop = () => {};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
const codeOf = err => String((err && (err.code || err.message)) || err);

// A socket that speaks HTTP/2 frames by hand. It sends WINDOW_UPDATE only when asked to, so a
// body larger than the initial window stays partly unsent.
class RawPeer {
  constructor(socket, role) {
    this.socket = socket;
    this.goaway = undefined;
    this.isClosed = false;
    this.streams = new Map();
    this.updates = new Map();
    this.buffered = Buffer.alloc(0);
    this.prefaceLeft = role === "server" ? PREFACE.length : 0;
    this.pings = 0;
    this.acks = 0;
    this.waiting = [];
    this.closed = new Promise(resolve =>
      socket.on("close", () => {
        // A closed socket ends every wait.
        this.isClosed = true;
        const waiting = this.waiting;
        this.waiting = [];
        for (const { resolve: wake } of waiting) wake();
        resolve();
      }),
    );
    socket.on("error", noop);
    socket.on("data", chunk => this.read(chunk));
    // Every frame leaves in its own write, with no wait for the ACK of the one before.
    socket.setNoDelay(true);
    if (role === "client") this.write(PREFACE);
    this.write(frameOf(4, 0, 0));
  }

  write(bytes) {
    if (this.isClosed || this.socket.destroyed || bytes.length === 0) return;
    this.socket.write(bytes);
  }

  // What arrived on a stream, in order: "H" for HEADERS, "D<bytes>" for DATA (frames in a row add
  // up), "R<code>" for RST_STREAM. "E" after "H" or "D<bytes>" is END_STREAM.
  wire(streamId) {
    return (this.streams.get(streamId) || []).join(" ");
  }

  // How many WINDOW_UPDATE frames arrived for a stream.
  windowUpdates(streamId) {
    return this.updates.get(streamId) || 0;
  }

  // The wire of stream 1, " G<code>" after a GOAWAY, " X" once the socket closed.
  snapshot() {
    return this.wire(1) + (this.goaway !== undefined ? " G" + this.goaway : "") + (this.isClosed ? " X" : "");
  }

  // Writes the frames with one socket write, so the endpoint reads them together.
  send(...frames) {
    this.write(Buffer.concat(frames));
  }

  // Opens the stream window and the connection window for the rest of BODY.
  grant(streamId) {
    this.send(windowUpdate(0), windowUpdate(streamId));
  }

  // A GET ends the request side with its HEADERS frame. A POST leaves it open. `more` goes in the same write.
  request(streamId, method, ...more) {
    // ":method", ":scheme: http" and ":path: /" are in the HPACK static table. ":authority" is a
    // literal with an indexed name.
    const block = Buffer.concat([
      Buffer.from([method === "GET" ? 0x82 : 0x83, 0x86, 0x84, 0x01, 0x09]),
      Buffer.from("localhost"),
    ]);
    this.send(frameOf(1, method === "GET" ? 0x5 : 0x4, streamId, block), ...more);
  }

  until(condition) {
    if (this.isClosed || condition()) return Promise.resolve();
    return new Promise(resolve => this.waiting.push({ condition, resolve }));
  }

  // Two PING round trips. The endpoint answers a PING when it reads it, so at the second answer
  // it has had a full turn of its event loop to send what close() or destroy() makes it send.
  async settle() {
    for (let i = 0; i < 2; i++) {
      const sent = ++this.pings;
      this.write(frameOf(6, 0, 0, Buffer.alloc(8)));
      await this.until(() => this.acks >= sent);
    }
  }

  read(chunk) {
    const skip = Math.min(this.prefaceLeft, chunk.length);
    this.prefaceLeft -= skip;
    let buffered = this.buffered.length ? Buffer.concat([this.buffered, chunk.subarray(skip)]) : chunk.subarray(skip);
    while (buffered.length >= 9) {
      const length = buffered.readUIntBE(0, 3);
      if (buffered.length < 9 + length) break;
      this.frame(buffered[3], buffered[4], buffered.readUInt32BE(5) & 0x7fffffff, buffered.subarray(9, 9 + length));
      buffered = buffered.subarray(9 + length);
      if (this.waiting.length) {
        this.waiting = this.waiting.filter(({ condition, resolve }) => !condition() || (resolve(), false));
      }
    }
    // A copy: the rest must not share memory with a chunk the runtime owns.
    this.buffered = buffered.length ? Buffer.from(buffered) : buffered;
  }

  frame(type, flags, streamId, payload) {
    if (type === 4) {
      if (!(flags & 0x1)) this.write(frameOf(4, 0x1, 0));
    } else if (type === 6) {
      if (flags & 0x1) this.acks++;
      else this.write(frameOf(6, 0x1, 0, payload));
    } else if (type === 7) {
      this.goaway = payload.length >= 8 ? payload.readUInt32BE(4) : -1;
    } else if (type === 8) {
      this.updates.set(streamId, this.windowUpdates(streamId) + 1);
    } else if (streamId !== 0) {
      let log = this.streams.get(streamId);
      if (!log) this.streams.set(streamId, (log = []));
      const last = log[log.length - 1];
      const end = flags & 0x1 ? "E" : "";
      if (type === 1) {
        log.push(`H${end}`);
      } else if (type === 0) {
        const open = last !== undefined && /^D\d+$/.test(last);
        const token = `D${(open ? Number(last.slice(1)) : 0) + payload.length}${end}`;
        if (open) log[log.length - 1] = token;
        else log.push(token);
      } else if (type === 3) {
        log.push(`R${payload.length >= 4 ? payload.readUInt32BE(0) : "?"}`);
      }
    }
  }
}

// Settles until two settles in a row leave the peer's view unchanged.
async function quiet(peer) {
  let previous;
  for (let i = 0; i < 8; i++) {
    await peer.settle();
    const now = `${peer.snapshot()}|${peer.windowUpdates(1)}`;
    if (now === previous) return;
    previous = now;
  }
}

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

const CALLS = {
  "close()": stream => stream.close(),
  "close(2)": stream => stream.close(2),
  "close(7)": stream => stream.close(7),
  "close(8)": stream => stream.close(8),
  "destroy()": stream => stream.destroy(),
};
// What the peer sends around the call: nothing more for the stream, END_STREAM on the frame of
// the event, END_STREAM on a later frame of the same read, or WINDOW_UPDATE for both windows.
const READS = ["none", "es-this", "es-later", "wu"];
const grantFrames = () => [windowUpdate(0), windowUpdate(1)];

// Client role: how the request is opened, and the wire the peer must see before the cell goes on.
const CLIENT_OWN = {
  GET: { ready: "HE", open: session => session.request({ ":path": "/" }) },
  ended: {
    ready: "H D5E",
    open: session => {
      const req = session.request({ ":method": "POST" });
      req.end("hello");
      return req;
    },
  },
  open: { ready: "H", open: session => session.request({ ":method": "POST" }) },
  stalled: {
    ready: STALLED,
    open: session => {
      const req = session.request({ ":method": "POST" });
      req.write(BODY);
      return req;
    },
  },
};
// Client role: site -> read -> the frames the peer sends in one socket write.
const afterHeaders = {
  none: [responseHeaders(1)],
  "es-this": [responseHeaders(1, true)],
  "es-later": [responseHeaders(1), dataFrame(1, 1, true)],
  wu: [responseHeaders(1), ...grantFrames()],
};
const CLIENT_SITES = {
  sync: { none: [] },
  writecb: { none: [] },
  immediate: {
    none: [],
    "es-this": [responseHeaders(1, true)],
    "es-later": [responseHeaders(1), dataFrame(1, 1, true)],
    wu: grantFrames(),
  },
  response: afterHeaders,
  await: afterHeaders,
  tick: afterHeaders,
  data: {
    none: [dataFrame(1, 1)],
    "es-this": [dataFrame(1, 1, true)],
    "es-later": [dataFrame(1, 1), dataFrame(1, 1, true)],
    wu: [dataFrame(1, 1), ...grantFrames()],
  },
  trailers: { "es-this": [trailersFrame()], wu: [trailersFrame(), ...grantFrames()] },
  end: { "es-this": [responseHeaders(1, true)], wu: [responseHeaders(1, true), ...grantFrames()] },
};

// Server role: what the 'stream' listener does before anything else, and the wire to wait for.
const SERVER_OWN = {
  none: { ready: "", setup: noop },
  ended: {
    ready: "H D5E",
    setup: stream => {
      stream.respond({ ":status": 200 });
      stream.end("hello");
    },
  },
  open: {
    ready: "H",
    setup: stream => {
      stream.respond({ ":status": 200 });
    },
  },
  stalled: {
    ready: STALLED,
    setup: stream => {
      stream.respond({ ":status": 200 });
      stream.write(BODY);
    },
  },
};
// Server role: site -> read -> [method of the request, frames in the write of the request
// HEADERS, frames of the later read].
const D = endStream => dataFrame(1, 4, endStream);
const afterData = {
  none: ["POST", [], [D(false)]],
  "es-this": ["POST", [], [D(true)]],
  "es-later": ["POST", [], [D(false), D(true)]],
  wu: ["POST", [], [D(false), ...grantFrames()]],
};
const SERVER_SITES = {
  stream: {
    none: ["POST", [], []],
    "es-this": ["GET", [], []],
    "es-later": ["POST", [D(true)], []],
    wu: ["POST", grantFrames(), []],
  },
  sync: { none: ["POST", [], []] },
  writecb: { none: ["POST", [], []] },
  immediate: {
    none: ["POST", [], []],
    "es-this": ["POST", [], [D(true)]],
    "es-later": ["POST", [], [D(false), D(true)]],
    wu: ["POST", [], grantFrames()],
  },
  data: afterData,
  await: afterData,
  tick: afterData,
  trailers: { "es-this": ["POST", [], [trailersFrame()]], wu: ["POST", [], [trailersFrame(), ...grantFrames()]] },
  end: {
    "es-this": ["POST", [], [dataFrame(1, 0, true)]],
    wu: ["POST", [], [dataFrame(1, 0, true), ...grantFrames()]],
  },
};

function cells() {
  const list = [];
  for (const [role, sites, owns] of [
    ["client", CLIENT_SITES, CLIENT_OWN],
    ["server", SERVER_SITES, SERVER_OWN],
  ]) {
    for (const site of Object.keys(sites)) {
      for (const read of READS) {
        if (!(read in sites[site])) continue;
        for (const own of Object.keys(owns)) {
          if (site === "writecb" && own !== "open" && own !== "stalled") continue;
          for (const call of Object.keys(CALLS)) {
            list.push({ id: `${role}|${site}|${read}|${own}|${call}`, role, site, read, own, call });
          }
        }
      }
    }
  }
  return list;
}

// ---------------------------------------------------------------------------------------------
// One cell
// ---------------------------------------------------------------------------------------------

const EVENTS = ["headers", "response", "trailers", "end", "aborted", "finish", "close", "data"];

// Records the events of the stream under test, from the call on.
function watch(c, stream) {
  const record = name => {
    if (c.over) return;
    if (c.called) c.ev.push(name);
    // 'immediate' only: an event between the peer's write and the call means that the session
    // read the frames before the call. The cell is then not what its id says.
    else if (c.sent) c.early.push(name);
  };
  for (const name of EVENTS) stream.on(name, () => record(name));
  stream.on("error", err => record("error:" + codeOf(err)));
}

// The call under test.
function fire(c) {
  if (c.over || c.called) return;
  c.called = true;
  try {
    CALLS[c.spec.call](c.stream);
  } catch (err) {
    c.ev.push("throw:" + codeOf(err));
  }
  c.made.resolve();
}

// After the call: the wire once it is quiet, then the wire after the peer opened both windows.
async function finish(c) {
  const peer = c.peer;
  await c.wait(c.made.promise);
  await c.wait(quiet(peer));
  c.pre = peer.snapshot();
  peer.grant(1);
  await c.wait(quiet(peer));
  c.post = peer.snapshot();
}

async function clientCell(c) {
  const { site, read, own } = c.spec;
  const frames = CLIENT_SITES[site][read];
  const accepted = deferred();
  const server = (c.server = net.createServer(socket => accepted.resolve(new RawPeer(socket, "server"))));
  server.on("error", noop);
  const port = await c.wait(listen(server));
  const session = (c.session = http2.connect(`http://127.0.0.1:${port}`));
  session.on("error", noop);
  const peer = (c.peer = await c.wait(accepted.promise));
  // The session is connected and has the peer's SETTINGS.
  await c.wait(peer.settle());

  const req = (c.stream = CLIENT_OWN[own].open(session));
  watch(c, req);
  // The peer has what the request sends on its own, and the session is idle.
  const ready = async () => {
    await c.wait(peer.until(() => peer.wire(1) === CLIENT_OWN[own].ready));
    await c.wait(peer.settle());
  };
  // The response HEADERS in a read of their own.
  const respond = async () => {
    const response = once(req, "response");
    response.catch(noop);
    peer.send(responseHeaders(1));
    await c.wait(response);
    await c.wait(peer.settle());
  };

  switch (site) {
    case "sync":
      await ready();
      fire(c);
      break;
    case "writecb":
      await ready();
      req.write("x", () => fire(c));
      break;
    case "immediate":
      // This continuation runs inside the data callback of the peer's socket: the immediate
      // runs before the event loop polls again, so before the session reads the frames.
      await ready();
      c.sent = true;
      peer.send(...frames);
      setImmediate(() => fire(c));
      break;
    case "response":
      req.once("response", () => fire(c));
      await ready();
      peer.send(...frames);
      break;
    case "await": {
      await ready();
      const response = once(req, "response");
      (async () => {
        await response;
        fire(c);
      })().catch(noop);
      peer.send(...frames);
      break;
    }
    case "tick":
      req.once("response", () => process.nextTick(() => fire(c)));
      await ready();
      peer.send(...frames);
      break;
    case "data":
      req.once("data", () => fire(c));
      await ready();
      await respond();
      peer.send(...frames);
      break;
    case "trailers":
      req.once("trailers", () => fire(c));
      await ready();
      await respond();
      peer.send(...frames);
      break;
    case "end":
      req.resume();
      req.once("end", () => fire(c));
      await ready();
      peer.send(...frames);
      break;
    default:
      throw new Error(`unknown site ${site}`);
  }
  await finish(c);
}

async function serverCell(c) {
  const { site, read, own } = c.spec;
  const [method, same, later] = SERVER_SITES[site][read];
  const opened = deferred();
  const server = (c.server = http2.createServer());
  server.on("error", noop);
  server.on("sessionError", noop);
  server.on("session", session => {
    c.session = session;
    session.on("error", noop);
  });
  server.on("stream", stream => {
    if (c.stream) return void stream.on("error", noop);
    try {
      SERVER_OWN[own].setup(stream);
      c.stream = stream;
      watch(c, stream);
      switch (site) {
        case "stream":
          fire(c);
          break;
        case "data":
          stream.once("data", () => fire(c));
          break;
        case "tick":
          stream.once("data", () => process.nextTick(() => fire(c)));
          break;
        case "trailers":
          stream.once("trailers", () => fire(c));
          break;
        case "end":
          stream.resume();
          stream.once("end", () => fire(c));
          break;
      }
      opened.resolve();
    } catch (err) {
      stream.on("error", noop);
      opened.reject(err);
    }
  });
  opened.promise.catch(noop);
  const port = await c.wait(listen(server));
  const socket = net.connect(port, "127.0.0.1");
  const peer = (c.peer = new RawPeer(socket, "client"));
  // The session exists and has the peer's SETTINGS.
  await c.wait(peer.settle());
  peer.request(1, method, ...same);
  await c.wait(opened.promise);
  const stream = c.stream;

  if (site !== "stream") {
    // One turn after 'stream': the session is not reading.
    if (site === "sync") await c.wait(nextTurn());
    await c.wait(peer.until(() => peer.wire(1) === SERVER_OWN[own].ready));
    await c.wait(peer.settle());
    switch (site) {
      case "sync":
        fire(c);
        break;
      case "writecb":
        stream.write("x", () => fire(c));
        break;
      case "immediate":
        // As in the client role: inside the data callback of the peer's socket.
        c.sent = true;
        peer.send(...later);
        setImmediate(() => fire(c));
        break;
      case "await": {
        const data = once(stream, "data");
        (async () => {
          await data;
          fire(c);
        })().catch(noop);
        peer.send(...later);
        break;
      }
      case "data":
      case "tick":
      case "trailers":
      case "end":
        peer.send(...later);
        break;
      default:
        throw new Error(`unknown site ${site}`);
    }
  }
  await finish(c);
}

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

const TIMEOUT = Symbol("timeout");
const running = new Set();

// The output line of a cell, from what it has collected so far. `status` is set for a cell that
// gave up (timeout, or an exception of the probe).
function collect(c, status) {
  const result = { id: c.spec.id };
  if (status !== undefined) result.status = status;
  if (c.pre !== undefined) result.pre = c.pre;
  if (c.post !== undefined) result.post = c.post;
  result.ev = c.ev.slice();
  if (c.peer) result.wu = c.peer.windowUpdates(1);
  if (c.stream) {
    try {
      result.st = `${c.stream.destroyed}/${c.stream.closed}/${c.stream.rstCode}`;
    } catch (err) {
      result.st = "throw:" + codeOf(err);
    }
  }
  // Where the wire stood when the cell gave up.
  if (status !== undefined && c.peer) result.wire = c.peer.snapshot();
  if (!c.called) result.nocall = true;
  if (c.early.length) result.early = c.early.slice();
  if (c.uncaught !== undefined) result.uncaught = c.uncaught;
  return result;
}

async function runCell(spec, timeoutMs) {
  const c = {
    spec,
    ev: [],
    early: [],
    called: false,
    sent: false,
    over: false,
    made: deferred(),
    stream: undefined,
    session: undefined,
    server: undefined,
    peer: undefined,
    pre: undefined,
    post: undefined,
    uncaught: undefined,
    wait: undefined,
  };
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(reject, timeoutMs, TIMEOUT)));
  timeout.catch(noop);
  // Every wait of a cell ends at the cell's timeout.
  c.wait = promise => Promise.race([promise, timeout]);

  running.add(c);
  const began = Date.now();
  let result;
  try {
    await (spec.role === "client" ? clientCell(c) : serverCell(c));
    result = collect(c);
  } catch (err) {
    result = collect(c, err === TIMEOUT ? "timeout" : "error:" + String((err && err.message) || err));
  } finally {
    clearTimeout(timer);
    // From here on no listener records anything and no trigger makes the call.
    c.over = true;
    running.delete(c);
    for (const cleanup of [
      () => c.session && c.session.destroy(),
      () => c.peer && c.peer.socket.destroy(),
      () => c.server && c.server.close(),
    ]) {
      try {
        cleanup();
      } catch {}
    }
  }
  // Not part of the result: how long the cell took, for work on the probe itself.
  if (process.env.DM_PROBE_MS) result.ms = Date.now() - began;
  return result;
}

function parseArgs(argv) {
  const args = { filter: undefined, concurrency: 16, list: false, timeout: 4000 };
  for (const arg of argv) {
    if (arg === "--list") args.list = true;
    else if (arg.startsWith("--filter=")) args.filter = arg.slice("--filter=".length);
    else if (arg.startsWith("--concurrency=")) args.concurrency = Math.max(1, Number(arg.slice("--concurrency=".length)) | 0);
    else if (arg.startsWith("--timeout=")) args.timeout = Math.max(1, Number(arg.slice("--timeout=".length)) | 0);
    else {
      process.stderr.write(`unknown argument ${arg}\nusage: gen.cjs [--filter=<substr>] [--concurrency=N] [--list] [--timeout=ms]\n`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let list = cells();
  if (args.filter !== undefined) list = list.filter(cell => cell.id.includes(args.filter));
  if (args.list) {
    for (const cell of list) process.stdout.write(cell.id + "\n");
    return;
  }

  // Best effort: an exception that nobody caught belongs to one of the cells that run now.
  const uncaught = err => {
    for (const c of running) if (c.uncaught === undefined) c.uncaught = codeOf(err);
  };
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", uncaught);
  // `gen.cjs | head`: nobody reads the rest.
  process.stdout.on("error", () => process.exit(0));

  const started = Date.now();
  const results = new Array(list.length);
  const counts = { status: 0, nocall: 0, uncaught: 0, early: 0 };
  let next = 0;
  let printed = 0;
  const flush = () => {
    while (printed < list.length && results[printed] !== undefined) {
      const result = results[printed];
      results[printed++] = null;
      for (const key of Object.keys(counts)) if (result[key] !== undefined) counts[key]++;
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  };
  // The order the cells start in. It is not the order of the output. A write callback on a
  // stalled stream does not fire on any runtime so far, and such a cell waits for its whole
  // timeout: these start first, so that the rest of the run goes on during their wait.
  const waitsLong = cell => (cell.site === "writecb" && cell.own === "stalled" ? 0 : 1);
  const order = list.map((_, index) => index).sort((a, b) => waitsLong(list[a]) - waitsLong(list[b]) || a - b);
  const worker = async () => {
    while (next < order.length) {
      const index = order[next++];
      results[index] = await runCell(list[index], args.timeout);
      flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, list.length) }, worker));

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
  process.stderr.write(
    `# ${list.length} cells in ${seconds}s on ${runtime}: ${counts.status} with status, ${counts.nocall} nocall, ` +
      `${counts.uncaught} uncaught, ${counts.early} early\n`,
  );
  // A handle that the runtime under test left open must not keep the process alive.
  process.stdout.write("", () => process.exit(0));
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`${(err && err.stack) || err}\n`);
    process.exit(1);
  });
} else {
  module.exports = {
    PREFACE,
    WINDOW,
    BODY,
    STALLED,
    frameOf,
    u32,
    windowUpdate,
    settings,
    responseHeaders,
    dataFrame,
    trailersFrame,
    nextTurn,
    deferred,
    listen,
    RawPeer,
    quiet,
    CALLS,
    READS,
    CLIENT_OWN,
    CLIENT_SITES,
    SERVER_OWN,
    SERVER_SITES,
    cells,
    runCell,
  };
}
