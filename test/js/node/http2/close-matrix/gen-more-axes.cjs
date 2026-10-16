"use strict";
// Probe: the axes that gen.cjs does not have. Same cell protocol and output line
// as gen.cjs ({"id","pre","post","ev","wu","st"} + status/nocall/uncaught/early), so tri.py and
// cmp.py read its output unchanged. Runs unchanged under Node.js and Bun.
//
//   <runtime> gen-more-axes.cjs [--fam=<name>[,<name>]] [--filter=<substr>] [--concurrency=N] [--list]
//                      [--timeout=ms] [--from=N]
//
// Cell id: fam|transport|role|site|read|own|call
//   fam        base      gen.cjs's own cells (a check that this harness equals gen.cjs on tcp)
//              transport gen.cjs's cells over TLS and over a JS stream (duplexPair)
//              read      peer RST_STREAM / GOAWAY in the same read as the frame of the event
//              site      call sites gen.cjs does not have: 'aborted', 'finish', 'drain', 'close',
//                        'timeout', 'wantTrailers', 'headers', session 'goaway',
//                        'remoteSettings', 'localSettings', ping callback
//              own       own-side states gen.cjs does not have: end(BODY) stalled,
//                        waitForTrailers, respondWithFile / respondWithFD
//              pending   a request made before the session has connected
//              push      pushed streams, both roles
const http2 = require("node:http2");
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const { once } = require("node:events");
const nodeStream = require("node:stream");
const base = require("./gen.cjs");

const { BODY, STALLED, frameOf, u32, windowUpdate, settings, responseHeaders, dataFrame, trailersFrame } = base;
const { nextTurn, deferred, listen, CALLS } = base;

const KEY = fs.readFileSync(__dirname + "/key.pem");
const CERT = fs.readFileSync(__dirname + "/cert.pem");
// As long as BODY: a file response stalls like write(BODY).
const BIG = __dirname + "/big.bin";
const SMALL = __dirname + "/small.bin";

const noop = () => {};
const codeOf = err => String((err && (err.code || err.message)) || err);
const rst = (id, code) => frameOf(3, 0, id, u32(code));
const goaway = (last, code) => frameOf(7, 0, 0, Buffer.concat([u32(last), u32(code)]));
// "103" as a literal ":status".
const earlyHints = () => frameOf(1, 0x4, 1, Buffer.from([0x08, 0x03, 0x31, 0x30, 0x33]));
const grantFrames = (id = 1) => [windowUpdate(0), windowUpdate(id)];
const REQUEST_BLOCK = Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01, 0x09]), Buffer.from("localhost")]);
// PUSH_PROMISE on stream 1 that promises stream 2, END_HEADERS.
const pushPromise = () => frameOf(5, 0x4, 1, Buffer.concat([u32(2), REQUEST_BLOCK]));
const BIG_WINDOW = 65535 + BODY.length;

class Peer extends base.RawPeer {
  constructor(socket, role) {
    if (typeof socket.setNoDelay !== "function") socket.setNoDelay = noop;
    super(socket, role);
  }
  snap(id) {
    return this.wire(id) + (this.goaway !== undefined ? " G" + this.goaway : "") + (this.isClosed ? " X" : "");
  }
}

// Settles until two settles in a row leave the peer's view unchanged. Over a JS stream a PING
// round trip is not a turn of the event loop, so two turns are added there.
async function quiet(c) {
  const peer = c.peer;
  let previous;
  for (let i = 0; i < 8; i++) {
    await peer.settle();
    if (c.spec.transport === "js") {
      await nextTurn();
      await nextTurn();
    }
    const now = `${peer.snap(1)}|${peer.snap(2)}|${peer.windowUpdates(1)}|${peer.windowUpdates(2)}`;
    if (now === previous) return;
    previous = now;
  }
}


// AXGAP_JS_IDLE=1: over a JS stream, two turns of the event loop after a settle. node completes
// a write to a JS stream in a setImmediate callback, so without them the answer to the PING of
// the settle is a write in flight when the peer's next frames arrive.
async function idle(c) {
  if (c.spec.transport === "js" && process.env.AXGAP_JS_IDLE) {
    await nextTurn();
    await nextTurn();
  }
}

// ---------------------------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------------------------

async function clientSetup(c, options) {
  const transport = c.spec.transport;
  if (transport === "js") {
    const [near, far] = nodeStream.duplexPair();
    c.peer = new Peer(far, "server");
    const session = (c.session = http2.connect("http://localhost", { ...options, createConnection: () => near }));
    session.on("error", noop);
    return { session, accepted: Promise.resolve(c.peer) };
  }
  const accepted = deferred();
  const onSocket = socket => {
    socket.on("error", noop);
    c.peer = new Peer(socket, "server");
    accepted.resolve(c.peer);
  };
  const server = (c.server =
    transport === "tls"
      ? tls.createServer({ key: KEY, cert: CERT, ALPNProtocols: ["h2"] }, onSocket)
      : net.createServer(onSocket));
  server.on("error", noop);
  server.on("tlsClientError", noop);
  const port = await c.wait(listen(server));
  const session = (c.session = http2.connect(`${transport === "tls" ? "https" : "http"}://127.0.0.1:${port}`, {
    ...options,
    ...(transport === "tls" ? { rejectUnauthorized: false } : {}),
  }));
  session.on("error", noop);
  return { session, accepted: accepted.promise };
}

async function serverSetup(c, onStream) {
  const transport = c.spec.transport;
  const server = (c.server = transport === "tls" ? http2.createSecureServer({ key: KEY, cert: CERT }) : http2.createServer());
  server.on("error", noop);
  server.on("sessionError", noop);
  server.on("tlsClientError", noop);
  server.on("session", session => {
    c.session = session;
    session.on("error", noop);
  });
  server.on("stream", onStream);
  let socket;
  if (transport === "js") {
    const [near, far] = nodeStream.duplexPair();
    server.emit("connection", near);
    socket = far;
  } else {
    const port = await c.wait(listen(server));
    socket =
      transport === "tls"
        ? tls.connect({ port, host: "127.0.0.1", ALPNProtocols: ["h2"], rejectUnauthorized: false })
        : net.connect(port, "127.0.0.1");
  }
  return (c.peer = new Peer(socket, "client"));
}

// ---------------------------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------------------------

const READS = ["none", "es-this", "es-later", "wu"];
// Frames of the peer that end the stream from its side, sent in the same write as the frame of
// the event (or, at 'immediate', in the read after the call).
const EXTRA_CLIENT = {
  rst0: () => rst(1, 0),
  rst2: () => rst(1, 2),
  rst8: () => rst(1, 8),
  // The last stream id of the GOAWAY is below the request, at the request, at the request with an error.
  "ga-below": () => goaway(0, 0),
  "ga-at": () => goaway(1, 0),
  "ga-err": () => goaway(1, 2),
};
const EXTRA_SERVER = {
  rst0: () => rst(1, 0),
  rst2: () => rst(1, 2),
  rst8: () => rst(1, 8),
  "ga-at": () => goaway(0, 0),
  "ga-err": () => goaway(0, 2),
};
// What an outer call does when the call under test runs in the 'aborted' listener it emits.
const OUTER = {
  "by-close()": stream => stream.close(),
  "by-close(2)": stream => stream.close(2),
  "by-destroy()": stream => stream.destroy(),
};

const post = (session, options) => session.request({ ":method": "POST" }, options);
// Answers 'wantTrailers' with trailers. The event and a throw of sendTrailers() are recorded.
function trailersListener(c, stream) {
  stream.on("wantTrailers", () => {
    c.record("wantTrailers");
    try {
      stream.sendTrailers({ "x-t": "1" });
    } catch (err) {
      c.record("sendTrailers-throw:" + codeOf(err));
    }
  });
}

// Client role: how the request is opened, and the wire the peer must see before the cell goes on.
const CLIENT_OWN = {
  GET: { ready: "HE", open: session => session.request({ ":path": "/" }) },
  ended: {
    ready: "H D5E",
    open: session => {
      const req = post(session);
      req.end("hello");
      return req;
    },
  },
  open: { ready: "H", open: session => post(session) },
  stalled: {
    ready: STALLED,
    open: session => {
      const req = post(session);
      req.write(BODY);
      return req;
    },
  },
  // Not in gen.cjs from here on.
  // User code ended the writable side and it has not finished: the arm of close() that waits.
  endBODY: {
    ready: STALLED,
    open: session => {
      const req = post(session);
      req.end(BODY);
      return req;
    },
  },
  "wt-open": { ready: "H", open: session => post(session, { waitForTrailers: true }) },
  "wt-ended": {
    ready: "H D5E",
    open: session => {
      const req = post(session, { waitForTrailers: true });
      req.end("hello");
      return req;
    },
  },
  "wt-ended-l": {
    ready: "H D5 HE",
    open: (session, c) => {
      const req = post(session, { waitForTrailers: true });
      trailersListener(c, req);
      req.end("hello");
      return req;
    },
  },
  "wt-stalled": {
    ready: STALLED,
    open: session => {
      const req = post(session, { waitForTrailers: true });
      req.write(BODY);
      return req;
    },
  },
  "wt-endBODY": {
    ready: STALLED,
    open: session => {
      const req = post(session, { waitForTrailers: true });
      req.end(BODY);
      return req;
    },
  },
  "wt-endBODY-l": {
    ready: STALLED,
    open: (session, c) => {
      const req = post(session, { waitForTrailers: true });
      trailersListener(c, req);
      req.end(BODY);
      return req;
    },
  },
};
const BASE_CLIENT_OWN = ["GET", "ended", "open", "stalled"];
const NEW_CLIENT_OWN = ["endBODY", "wt-open", "wt-ended", "wt-ended-l", "wt-stalled", "wt-endBODY", "wt-endBODY-l"];
// A request made before the session has connected. `pending` is what req.pending must be.
const PENDING_OWN = {
  "p-GET": session => session.request({ ":path": "/" }),
  "p-open": session => post(session),
  "p-hello": session => {
    const req = post(session);
    req.write("hello");
    return req;
  },
  "p-ended": session => {
    const req = post(session);
    req.end("hello");
    return req;
  },
  "p-stalled": session => {
    const req = post(session);
    req.write(BODY);
    return req;
  },
  "p-endBODY": session => {
    const req = post(session);
    req.end(BODY);
    return req;
  },
};

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
// Not in gen.cjs: site -> read -> frames, and the owns the site makes sense for.
const NEW_CLIENT_SITES = {
  // The peer's RST_STREAM emits 'aborted' while the writable side is open.
  aborted: { reads: { rst0: [rst(1, 0)], rst2: [rst(1, 2)], rst8: [rst(1, 8)] }, owns: ["open", "stalled"] },
  // The 'aborted' of an outer close() or destroy().
  "aborted-own": { reads: { "by-close()": [], "by-close(2)": [], "by-destroy()": [] }, owns: ["open", "stalled"] },
  finish: { reads: { none: [] }, owns: ["GET", "ended", "open"] },
  "finish-wu": { reads: { wu: grantFrames() }, owns: ["endBODY"] },
  drain: { reads: { wu: grantFrames() }, owns: ["stalled"] },
  close: { reads: { "es-this": [responseHeaders(1, true)] }, owns: ["GET", "ended"] },
  "close-rst": { reads: { rst8: [rst(1, 8)], rst2: [rst(1, 2)] }, owns: ["open", "stalled"] },
  timeout: { reads: { none: [] }, owns: BASE_CLIENT_OWN },
  wantTrailers: { reads: { none: [] }, owns: ["wt-open"] },
  "wantTrailers-wu": { reads: { wu: grantFrames() }, owns: ["wt-stalled"] },
  goaway: {
    reads: { "ga-below": [goaway(0, 0)], "ga-at": [goaway(1, 0)], "ga-err": [goaway(1, 2)] },
    owns: BASE_CLIENT_OWN,
  },
  remoteSettings: {
    reads: {
      set: [settings(4, BIG_WINDOW)],
      "set-wu": [settings(4, BIG_WINDOW), windowUpdate(0)],
      "wu-set": [windowUpdate(0), settings(4, BIG_WINDOW)],
    },
    owns: BASE_CLIENT_OWN,
  },
  localSettings: { reads: { none: [] }, owns: BASE_CLIENT_OWN },
  ping: { reads: { none: [] }, owns: BASE_CLIENT_OWN },
  headers: {
    reads: {
      none: [earlyHints()],
      "es-later": [earlyHints(), responseHeaders(1, true)],
      "hdr-later": [earlyHints(), responseHeaders(1), dataFrame(1, 1)],
      wu: [earlyHints(), ...grantFrames()],
    },
    owns: BASE_CLIENT_OWN,
  },
};

// Server role: what the 'stream' listener does before anything else, and the wire to wait for.
const respond = (stream, options) => stream.respond({ ":status": 200 }, options);
const SERVER_OWN = {
  none: { ready: "", setup: noop },
  ended: {
    ready: "H D5E",
    setup: stream => {
      respond(stream);
      stream.end("hello");
    },
  },
  open: { ready: "H", setup: stream => respond(stream) },
  stalled: {
    ready: STALLED,
    setup: stream => {
      respond(stream);
      stream.write(BODY);
    },
  },
  // Not in gen.cjs from here on.
  endBODY: {
    ready: STALLED,
    setup: stream => {
      respond(stream);
      stream.end(BODY);
    },
  },
  "wt-open": { ready: "H", setup: stream => respond(stream, { waitForTrailers: true }) },
  "wt-ended": {
    ready: "H D5E",
    setup: stream => {
      respond(stream, { waitForTrailers: true });
      stream.end("hello");
    },
  },
  "wt-ended-l": {
    ready: "H D5 HE",
    setup: (stream, c) => {
      respond(stream, { waitForTrailers: true });
      trailersListener(c, stream);
      stream.end("hello");
    },
  },
  "wt-stalled": {
    ready: STALLED,
    setup: stream => {
      respond(stream, { waitForTrailers: true });
      stream.write(BODY);
    },
  },
  "wt-endBODY": {
    ready: STALLED,
    setup: stream => {
      respond(stream, { waitForTrailers: true });
      stream.end(BODY);
    },
  },
  "wt-endBODY-l": {
    ready: STALLED,
    setup: (stream, c) => {
      respond(stream, { waitForTrailers: true });
      trailersListener(c, stream);
      stream.end(BODY);
    },
  },
  file: { ready: STALLED, setup: stream => stream.respondWithFile(BIG) },
  fd: {
    ready: STALLED,
    setup: (stream, c) => {
      const fd = fs.openSync(BIG, "r");
      c.fds.push(fd);
      stream.respondWithFD(fd);
    },
  },
  "file-small": { ready: "H D1000E", setup: stream => stream.respondWithFile(SMALL) },
  "file-wt": { ready: STALLED, setup: stream => stream.respondWithFile(BIG, {}, { waitForTrailers: true }) },
};
const BASE_SERVER_OWN = ["none", "ended", "open", "stalled"];
const NEW_SERVER_OWN = [
  "endBODY",
  "wt-open",
  "wt-ended",
  "wt-ended-l",
  "wt-stalled",
  "wt-endBODY",
  "wt-endBODY-l",
  "file",
  "fd",
  "file-small",
  "file-wt",
];
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
const NEW_SERVER_SITES = {
  aborted: {
    reads: { rst0: ["POST", [], [rst(1, 0)]], rst2: ["POST", [], [rst(1, 2)]], rst8: ["POST", [], [rst(1, 8)]] },
    owns: ["none", "open", "stalled"],
  },
  "aborted-own": {
    reads: { "by-close()": ["POST", [], []], "by-close(2)": ["POST", [], []], "by-destroy()": ["POST", [], []] },
    owns: ["none", "open", "stalled"],
  },
  finish: { reads: { none: ["POST", [], []], "es-this": ["GET", [], []] }, owns: ["ended"] },
  "finish-wu": { reads: { wu: ["POST", [], grantFrames()] }, owns: ["endBODY"] },
  drain: { reads: { wu: ["POST", [], grantFrames()] }, owns: ["stalled"] },
  close: { reads: { "es-this": ["GET", [], []] }, owns: ["ended"] },
  "close-rst": { reads: { rst8: ["POST", [], [rst(1, 8)]], rst2: ["POST", [], [rst(1, 2)]] }, owns: ["open", "stalled"] },
  timeout: { reads: { none: ["POST", [], []] }, owns: BASE_SERVER_OWN },
  wantTrailers: { reads: { none: ["POST", [], []] }, owns: ["wt-open"] },
  "wantTrailers-wu": { reads: { wu: ["POST", [], grantFrames()] }, owns: ["wt-stalled"] },
  goaway: { reads: { "ga-at": ["POST", [], [goaway(0, 0)]], "ga-err": ["POST", [], [goaway(0, 2)]] }, owns: BASE_SERVER_OWN },
  remoteSettings: {
    reads: {
      set: ["POST", [], [settings(4, BIG_WINDOW)]],
      "set-wu": ["POST", [], [settings(4, BIG_WINDOW), windowUpdate(0)]],
      "wu-set": ["POST", [], [windowUpdate(0), settings(4, BIG_WINDOW)]],
    },
    owns: BASE_SERVER_OWN,
  },
  localSettings: { reads: { none: ["POST", [], []] }, owns: BASE_SERVER_OWN },
  ping: { reads: { none: ["POST", [], []] }, owns: BASE_SERVER_OWN },
};

// Pushed streams. Server role: the stream under test is the one pushStream() gives (stream 2).
const PUSH_SERVER_OWN = {
  "push-none": { ready: "", setup: noop },
  "push-open": { ready: "H", setup: push => respond(push) },
  "push-ended": {
    ready: "H D5E",
    setup: push => {
      respond(push);
      push.end("hello");
    },
  },
  "push-stalled": {
    ready: STALLED,
    setup: push => {
      respond(push);
      push.write(BODY);
    },
  },
  "push-endBODY": {
    ready: STALLED,
    setup: push => {
      respond(push);
      push.end(BODY);
    },
  },
};
// site -> read -> the frames the peer sends around the call.
const PUSH_SERVER_SITES = {
  pushcb: { none: [] },
  sync: { none: [] },
  immediate: { none: [], wu: grantFrames(2), rst8: [rst(2, 8)], rst0: [rst(2, 0)] },
  aborted: { rst8: [rst(2, 8)], rst2: [rst(2, 2)] },
};
// Client role: the stream under test is the pushed stream the session's 'stream' event gives.
const pushHeaders = endStream => frameOf(1, endStream ? 0x5 : 0x4, 2, Buffer.from([0x88]));
const pushData = (bytes, endStream) => frameOf(0, endStream ? 0x1 : 0, 2, Buffer.alloc(bytes, "p"));
// site -> read -> [frames in the write of PUSH_PROMISE, frames of the later read].
const PUSH_CLIENT_SITES = {
  stream: {
    none: [[], []],
    "hdr-later": [[pushHeaders(false)], []],
    "es-later": [[pushHeaders(true)], []],
    "data-later": [[pushHeaders(false), pushData(1, true)], []],
    "rst-later": [[rst(2, 8)], []],
  },
  sync: { none: [[], []] },
  immediate: {
    none: [[], []],
    "hdr-later": [[], [pushHeaders(false)]],
    "es-later": [[], [pushHeaders(true)]],
    "data-later": [[], [pushHeaders(false), pushData(1, true)]],
    "rst-later": [[], [rst(2, 8)]],
  },
  push: {
    none: [[], [pushHeaders(false)]],
    "es-this": [[], [pushHeaders(true)]],
    "es-later": [[], [pushHeaders(false), pushData(1, true)]],
    "rst-later": [[], [pushHeaders(false), rst(2, 8)]],
  },
  data: {
    none: [[pushHeaders(false)], [pushData(1, false)]],
    "es-this": [[pushHeaders(false)], [pushData(1, true)]],
    "es-later": [[pushHeaders(false)], [pushData(1, false), pushData(1, true)]],
  },
};

function cells() {
  const list = [];
  const add = (fam, transport, role, site, read, own, call) =>
    list.push({ id: `${fam}|${transport}|${role}|${site}|${read}|${own}|${call}`, fam, transport, role, site, read, own, call });
  const calls = Object.keys(CALLS);

  // base and transport: the cells of gen.cjs, over tcp, tls and a JS stream.
  for (const [fam, transport] of [
    ["base", "tcp"],
    ["transport", "tls"],
    ["transport", "js"],
  ]) {
    for (const [role, sites, owns] of [
      ["client", CLIENT_SITES, BASE_CLIENT_OWN],
      ["server", SERVER_SITES, BASE_SERVER_OWN],
    ]) {
      for (const site of Object.keys(sites)) {
        for (const read of READS) {
          if (!(read in sites[site])) continue;
          for (const own of owns) {
            if (site === "writecb" && own !== "open" && own !== "stalled") continue;
            for (const call of calls) add(fam, transport, role, site, read, own, call);
          }
        }
      }
    }
  }

  // read: the peer's RST_STREAM or GOAWAY in the read of the event.
  for (const [role, extra, owns, sites] of [
    ["client", EXTRA_CLIENT, BASE_CLIENT_OWN, ["immediate", "response", "await", "tick", "data", "trailers", "end"]],
    ["server", EXTRA_SERVER, BASE_SERVER_OWN, ["stream", "immediate", "data", "await", "tick", "trailers", "end"]],
  ]) {
    for (const site of sites) {
      for (const read of Object.keys(extra)) {
        for (const own of owns) for (const call of calls) add("read", "tcp", role, site, read, own, call);
      }
    }
  }

  // site: call sites gen.cjs does not have.
  for (const [role, sites] of [
    ["client", NEW_CLIENT_SITES],
    ["server", NEW_SERVER_SITES],
  ]) {
    for (const site of Object.keys(sites)) {
      for (const read of Object.keys(sites[site].reads)) {
        for (const own of sites[site].owns) for (const call of calls) add("site", "tcp", role, site, read, own, call);
      }
    }
  }

  // own: own-side states gen.cjs does not have, at gen.cjs's sites.
  for (const [role, sites, owns] of [
    ["client", CLIENT_SITES, NEW_CLIENT_OWN],
    ["server", SERVER_SITES, NEW_SERVER_OWN],
  ]) {
    for (const site of Object.keys(sites)) {
      // A write after end() is an error of its own.
      if (site === "writecb") continue;
      for (const read of READS) {
        if (!(read in sites[site])) continue;
        for (const own of owns) for (const call of calls) add("own", "tcp", role, site, read, own, call);
      }
    }
  }

  // pending: a request made before the session has connected.
  for (const site of ["sync", "tick", "ready", "connect"]) {
    for (const own of Object.keys(PENDING_OWN)) for (const call of calls) add("pending", "tcp", "client", site, "none", own, call);
  }

  // push
  for (const site of Object.keys(PUSH_SERVER_SITES)) {
    for (const read of Object.keys(PUSH_SERVER_SITES[site])) {
      for (const own of Object.keys(PUSH_SERVER_OWN)) {
        if (site === "aborted" && own !== "push-open" && own !== "push-stalled" && own !== "push-none") continue;
        for (const call of calls) add("push", "tcp", "server", site, read, own, call);
      }
    }
  }
  for (const site of Object.keys(PUSH_CLIENT_SITES)) {
    for (const read of Object.keys(PUSH_CLIENT_SITES[site])) {
      for (const call of calls) add("push", "tcp", "client", site, read, "pushed", call);
    }
  }
  return list;
}

// ---------------------------------------------------------------------------------------------
// One cell
// ---------------------------------------------------------------------------------------------

const EVENTS = ["headers", "response", "trailers", "end", "aborted", "finish", "close", "data"];

// Records the events of the stream under test, from the call on.
function watch(c, stream, more = []) {
  for (const name of EVENTS.concat(more)) stream.on(name, () => c.record(name));
  stream.on("error", err => c.record("error:" + codeOf(err)));
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
  await c.wait(quiet(c));
  c.pre = peer.snap(c.sid);
  peer.send(windowUpdate(0), windowUpdate(c.sid));
  await c.wait(quiet(c));
  c.post = peer.snap(c.sid);
}

function clientFrames(c) {
  const { fam, site, read } = c.spec;
  if (fam === "site") return NEW_CLIENT_SITES[site].reads[read];
  const reads = CLIENT_SITES[site];
  if (read in reads) return reads[read];
  // read family: the frame of the event, then the peer's RST_STREAM or GOAWAY.
  return [...(reads.none || reads["es-this"]), EXTRA_CLIENT[read]()];
}

async function clientCell(c) {
  const { site, read, own } = c.spec;
  const frames = clientFrames(c);
  const { session, accepted } = await clientSetup(c);
  const peer = await c.wait(accepted);
  // The session is connected and has the peer's SETTINGS.
  await c.wait(peer.settle());

  const req = (c.stream = CLIENT_OWN[own].open(session, c));
  watch(c, req);
  // The peer has what the request sends on its own, and the session is idle.
  const ready = async () => {
    await c.wait(peer.until(() => peer.wire(1) === CLIENT_OWN[own].ready));
    await c.wait(peer.settle());
    await idle(c);
  };
  // The response HEADERS in a read of their own.
  const respondFirst = async () => {
    const response = once(req, "response");
    response.catch(noop);
    peer.send(responseHeaders(1));
    await c.wait(response);
    await c.wait(peer.settle());
    await idle(c);
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
      await respondFirst();
      peer.send(...frames);
      break;
    case "trailers":
      req.once("trailers", () => fire(c));
      await ready();
      await respondFirst();
      peer.send(...frames);
      break;
    case "end":
      req.resume();
      req.once("end", () => fire(c));
      await ready();
      peer.send(...frames);
      break;
    // Not in gen.cjs from here on.
    case "aborted":
      req.once("aborted", () => fire(c));
      await ready();
      peer.send(...frames);
      break;
    case "aborted-own":
      req.once("aborted", () => fire(c));
      await ready();
      try {
        OUTER[read](req);
      } catch (err) {
        c.record("outer-throw:" + codeOf(err));
      }
      break;
    case "finish":
      req.once("finish", () => fire(c));
      await ready();
      if (own === "open") req.end("hello");
      break;
    case "finish-wu":
    case "drain":
    case "wantTrailers-wu":
      req.once(site === "finish-wu" ? "finish" : site === "drain" ? "drain" : "wantTrailers", () => fire(c));
      await ready();
      if (site === "wantTrailers-wu") req.end();
      peer.send(...frames);
      break;
    case "wantTrailers":
      req.once("wantTrailers", () => fire(c));
      await ready();
      req.end("hello");
      break;
    case "close":
    case "close-rst":
      req.resume();
      req.once("close", () => fire(c));
      await ready();
      peer.send(...frames);
      break;
    case "timeout":
      await ready();
      req.setTimeout(40, () => fire(c));
      break;
    case "goaway":
      await ready();
      session.once("goaway", () => fire(c));
      peer.send(...frames);
      break;
    case "remoteSettings":
      await ready();
      session.once("remoteSettings", () => fire(c));
      peer.send(...frames);
      break;
    case "localSettings":
      await ready();
      session.once("localSettings", () => fire(c));
      session.settings({ maxHeaderListSize: 65536 });
      break;
    case "ping":
      await ready();
      session.ping(() => fire(c));
      break;
    case "headers":
      req.once("headers", () => fire(c));
      await ready();
      peer.send(...frames);
      break;
    default:
      throw new Error(`unknown site ${site}`);
  }
  await finish(c);
}

// A request made before the session has connected.
async function pendingCell(c) {
  const { site, own } = c.spec;
  const { session, accepted } = await clientSetup(c);
  const req = (c.stream = PENDING_OWN[own](session));
  if (!req.pending) c.record("not-pending");
  watch(c, req, ["ready"]);
  switch (site) {
    case "sync":
      fire(c);
      break;
    case "tick":
      process.nextTick(() => fire(c));
      break;
    case "ready":
      req.once("ready", () => fire(c));
      break;
    case "connect":
      session.once("connect", () => fire(c));
      break;
    default:
      throw new Error(`unknown site ${site}`);
  }
  await c.wait(accepted);
  await finish(c);
}

function serverFrames(c) {
  const { fam, site, read } = c.spec;
  if (fam === "site") return NEW_SERVER_SITES[site].reads[read];
  const reads = SERVER_SITES[site];
  if (read in reads) return reads[read];
  const extra = EXTRA_SERVER[read]();
  const [method, same, later] = reads.none || reads["es-this"];
  return site === "stream" ? [method, [...same, extra], later] : [method, same, [...later, extra]];
}

async function serverCell(c) {
  const { site, read, own } = c.spec;
  const [method, same, later] = serverFrames(c);
  const opened = deferred();
  const peer = await serverSetup(c, stream => {
    if (c.stream) return void stream.on("error", noop);
    try {
      // The listeners of the own side's events go on before the own side acts.
      if (site === "finish" || site === "finish-wu") stream.once("finish", () => fire(c));
      if (site === "wantTrailers" || site === "wantTrailers-wu") stream.once("wantTrailers", () => fire(c));
      SERVER_OWN[own].setup(stream, c);
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
        case "aborted":
        case "aborted-own":
          stream.once("aborted", () => fire(c));
          break;
        case "drain":
          stream.once("drain", () => fire(c));
          break;
        case "close":
        case "close-rst":
          stream.resume();
          stream.once("close", () => fire(c));
          break;
      }
      opened.resolve();
    } catch (err) {
      stream.on("error", noop);
      opened.reject(err);
    }
  });
  opened.promise.catch(noop);
  // The session exists and has the peer's SETTINGS.
  await c.wait(peer.settle());
  await idle(c);
  peer.request(1, method, ...same);
  await c.wait(opened.promise);
  const stream = c.stream;

  if (site !== "stream") {
    // One turn after 'stream': the session is not reading.
    if (site === "sync") await c.wait(nextTurn());
    await c.wait(peer.until(() => peer.wire(1) === SERVER_OWN[own].ready));
    await c.wait(peer.settle());
    await idle(c);
    switch (site) {
      case "sync":
        fire(c);
        break;
      case "writecb":
        stream.write("x", () => fire(c));
        break;
      case "immediate":
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
      case "aborted":
      case "finish":
      case "finish-wu":
      case "drain":
      case "close":
      case "close-rst":
        peer.send(...later);
        break;
      case "aborted-own":
        try {
          OUTER[read](stream);
        } catch (err) {
          c.record("outer-throw:" + codeOf(err));
        }
        break;
      case "wantTrailers":
        stream.end("hello");
        break;
      case "wantTrailers-wu":
        stream.end();
        peer.send(...later);
        break;
      case "timeout":
        stream.setTimeout(40, () => fire(c));
        break;
      case "goaway":
        c.session.once("goaway", () => fire(c));
        peer.send(...later);
        break;
      case "remoteSettings":
        c.session.once("remoteSettings", () => fire(c));
        peer.send(...later);
        break;
      case "localSettings":
        c.session.once("localSettings", () => fire(c));
        c.session.settings({ maxHeaderListSize: 65536 });
        break;
      case "ping":
        c.session.ping(() => fire(c));
        break;
      default:
        throw new Error(`unknown site ${site}`);
    }
  }
  await finish(c);
}

// Server role, the stream under test is a pushed stream (stream 2).
async function pushServerCell(c) {
  const { site, read, own } = c.spec;
  const frames = PUSH_SERVER_SITES[site][read];
  const opened = deferred();
  c.sid = 2;
  const peer = await serverSetup(c, stream => {
    stream.on("error", noop);
    if (c.parent) return;
    c.parent = stream;
    try {
      respond(stream);
      stream.pushStream({ ":path": "/pushed" }, (err, push) => {
        if (err) return void opened.reject(err);
        try {
          if (site === "aborted") push.once("aborted", () => fire(c));
          PUSH_SERVER_OWN[own].setup(push);
          c.stream = push;
          watch(c, push);
          if (site === "pushcb") fire(c);
          opened.resolve();
        } catch (error) {
          push.on("error", noop);
          opened.reject(error);
        }
      });
      stream.end("parent");
    } catch (err) {
      opened.reject(err);
    }
  });
  opened.promise.catch(noop);
  await c.wait(peer.settle());
  peer.request(1, "GET");
  await c.wait(opened.promise);
  if (site !== "pushcb") {
    await c.wait(peer.until(() => peer.wire(2) === PUSH_SERVER_OWN[own].ready));
    await c.wait(peer.settle());
    switch (site) {
      case "sync":
        fire(c);
        break;
      case "immediate":
        c.sent = true;
        peer.send(...frames);
        setImmediate(() => fire(c));
        break;
      case "aborted":
        peer.send(...frames);
        break;
      default:
        throw new Error(`unknown site ${site}`);
    }
  }
  await finish(c);
}

// Client role, the stream under test is the pushed stream of the session's 'stream' event.
async function pushClientCell(c) {
  const { site, read } = c.spec;
  const [same, later] = PUSH_CLIENT_SITES[site][read];
  c.sid = 2;
  const { session, accepted } = await clientSetup(c);
  const peer = await c.wait(accepted);
  await c.wait(peer.settle());
  const pushed = deferred();
  pushed.promise.catch(noop);
  session.on("stream", stream => {
    if (c.stream) return void stream.on("error", noop);
    c.stream = stream;
    watch(c, stream, ["push"]);
    if (site === "stream") fire(c);
    if (site === "push") stream.once("push", () => fire(c));
    if (site === "data") stream.once("data", () => fire(c));
    pushed.resolve();
  });
  const parent = session.request({ ":path": "/" });
  parent.on("error", noop);
  parent.resume();
  await c.wait(peer.until(() => peer.wire(1) === "HE"));
  await c.wait(peer.settle());
  peer.send(pushPromise(), ...same);
  await c.wait(pushed.promise);
  if (site !== "stream") {
    await c.wait(peer.settle());
    switch (site) {
      case "sync":
        fire(c);
        break;
      case "immediate":
        c.sent = true;
        peer.send(...later);
        setImmediate(() => fire(c));
        break;
      case "push":
      case "data":
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

function collect(c, status) {
  const result = { id: c.spec.id };
  if (status !== undefined) result.status = status;
  if (c.pre !== undefined) result.pre = c.pre;
  if (c.post !== undefined) result.post = c.post;
  result.ev = c.ev.slice();
  if (c.peer) result.wu = c.peer.windowUpdates(c.sid);
  if (c.stream) {
    try {
      result.st = `${c.stream.destroyed}/${c.stream.closed}/${c.stream.rstCode}`;
    } catch (err) {
      result.st = "throw:" + codeOf(err);
    }
  }
  if (status !== undefined && c.peer) result.wire = c.peer.snap(c.sid);
  if (!c.called) result.nocall = true;
  if (c.early.length) result.early = c.early.slice();
  if (c.uncaught !== undefined) result.uncaught = c.uncaught;
  return result;
}

async function runCell(spec, timeoutMs) {
  const c = {
    spec,
    sid: 1,
    ev: [],
    early: [],
    fds: [],
    called: false,
    sent: false,
    over: false,
    made: deferred(),
    stream: undefined,
    parent: undefined,
    session: undefined,
    server: undefined,
    peer: undefined,
    pre: undefined,
    post: undefined,
    uncaught: undefined,
    wait: undefined,
    record: undefined,
  };
  c.record = name => {
    if (c.over) return;
    if (c.called) c.ev.push(name);
    else if (c.sent) c.early.push(name);
  };
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(reject, timeoutMs, TIMEOUT)));
  timeout.catch(noop);
  c.wait = promise => Promise.race([promise, timeout]);

  running.add(c);
  let result;
  try {
    if (spec.fam === "pending") await pendingCell(c);
    else if (spec.fam === "push") await (spec.role === "client" ? pushClientCell(c) : pushServerCell(c));
    else await (spec.role === "client" ? clientCell(c) : serverCell(c));
    result = collect(c);
  } catch (err) {
    result = collect(c, err === TIMEOUT ? "timeout" : "error:" + String((err && err.message) || err));
  } finally {
    clearTimeout(timer);
    c.over = true;
    running.delete(c);
    for (const cleanup of [
      () => c.session && c.session.destroy(),
      () => c.peer && c.peer.socket.destroy(),
      () => c.server && c.server.close(),
      () => c.fds.forEach(fd => fs.closeSync(fd)),
    ]) {
      try {
        cleanup();
      } catch {}
    }
  }
  return result;
}

function parseArgs(argv) {
  const args = { fam: undefined, filter: undefined, concurrency: 16, list: false, timeout: 4000, from: 0, ids: undefined };
  for (const arg of argv) {
    if (arg === "--list") args.list = true;
    else if (arg.startsWith("--fam=")) args.fam = arg.slice("--fam=".length).split(",");
    else if (arg.startsWith("--filter=")) args.filter = arg.slice("--filter=".length);
    else if (arg.startsWith("--concurrency=")) args.concurrency = Math.max(1, Number(arg.slice("--concurrency=".length)) | 0);
    else if (arg.startsWith("--timeout=")) args.timeout = Math.max(1, Number(arg.slice("--timeout=".length)) | 0);
    else if (arg.startsWith("--from=")) args.from = Math.max(0, Number(arg.slice("--from=".length)) | 0);
    else if (arg.startsWith("--ids=")) args.ids = new Set(fs.readFileSync(arg.slice("--ids=".length), "utf8").split("\n").filter(Boolean));
    else {
      process.stderr.write(`unknown argument ${arg}\n`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let list = cells();
  if (args.fam !== undefined) list = list.filter(cell => args.fam.includes(cell.fam));
  if (args.filter !== undefined) list = list.filter(cell => cell.id.includes(args.filter));
  if (args.from) list = list.slice(args.from);
  if (args.ids !== undefined) list = list.filter(cell => args.ids.has(cell.id));
  if (args.list) {
    for (const cell of list) process.stdout.write(cell.id + "\n");
    return;
  }

  const uncaught = err => {
    for (const c of running) if (c.uncaught === undefined) c.uncaught = codeOf(err);
  };
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", uncaught);
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
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
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
  process.stdout.write("", () => process.exit(0));
}

main().catch(err => {
  process.stderr.write(`${(err && err.stack) || err}\n`);
  process.exit(1);
});
