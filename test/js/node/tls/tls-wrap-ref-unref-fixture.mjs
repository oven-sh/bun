// ref() and unref() on a TLS socket that wraps another stream. In Node.js the TLS handle passes
// both to the handle that it wraps, and a JS stream has no handle:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L635-L654
//
// Each wrap below is the only thing that can keep the process alive: its peer and its server are
// unref'd or closed. The process has no timer and calls no process.exit(). It prints what every
// wrap saw when it exits, and it must exit by itself. "at rest" is the first time that nothing
// kept the process alive: it goes to every wrap that was open then.
//
//   argv[2]: which wraps to make. See the end of this file.
//   TLS_CERT and TLS_KEY: the certificate of every TLS server here.
import net from "node:net";
import { duplexPair } from "node:stream";
import tls from "node:tls";

const { TLS_CERT: cert, TLS_KEY: key } = process.env;
const insecure = { rejectUnauthorized: false };

const results = {};
const open = new Set();
// These run one at a time, each when nothing keeps the process alive. A step that does not make
// something keep it alive again is the last one: the process exits behind it.
const later = [];
let last;
let rested = false;
process.on("beforeExit", () => {
  if (!rested) {
    rested = true;
    for (const events of open) events.push("at rest");
  }
  const step = later.shift();
  if (step) return step();
  last?.();
  last = undefined;
});
process.on("exit", () => console.log(JSON.stringify(results)));

function observe(name, wrap, data = true) {
  const events = (results[name] = []);
  open.add(events);
  if (data) wrap.on("data", chunk => events.push(`${chunk}`));
  wrap.on("end", () => events.push("end"));
  wrap.on("error", err => events.push(`error ${err.code}`));
  wrap.on("close", () => {
    events.push("close");
    open.delete(events);
  });
  return events;
}

function quiet(socket) {
  socket.on("error", () => {});
  return socket;
}

// The peer of a server-side wrap: a TLS client that does not keep the process alive. With
// `inner`, it speaks TLS inside that TLS connection.
function unrefedClient(port, inner) {
  const { promise, resolve } = Promise.withResolvers();
  const client = quiet(tls.connect({ port, host: "127.0.0.1", ...insecure }));
  client.unref();
  if (!inner) resolve(client);
  else client.once("secureConnect", () => resolve(quiet(tls.connect({ socket: client, ...insecure }))));
  return promise;
}

// use(raw, wrapIt, handshake, peer): `wrapIt()` puts the TLS socket on `raw`, `handshake` is the
// event of its handshake, and `peer` is a promise of the TLS socket at the other end.
const kinds = {
  // The TLS engine of the inner socket reads the outer one as a stream. The outer one has the handle.
  "TLS in TLS, server side"(use) {
    const server = tls.createServer({ cert, key }, outer => {
      server.close();
      use(quiet(outer), () => new tls.TLSSocket(outer, { isServer: true, cert, key }), "secure", peer);
    });
    const peer = new Promise(resolve => {
      server.listen(0, "127.0.0.1", () => resolve(unrefedClient(server.address().port, true)));
    });
  },
  "TLS in TLS, client side"(use) {
    const peer = Promise.withResolvers();
    const server = tls.createServer({ cert, key }, outer => {
      server.close();
      quiet(outer).unref();
      peer.resolve(quiet(new tls.TLSSocket(outer, { isServer: true, cert, key })));
    });
    server.listen(0, "127.0.0.1", () => {
      const outer = quiet(tls.connect({ port: server.address().port, host: "127.0.0.1", ...insecure }));
      outer.once("secureConnect", () => {
        use(outer, () => tls.connect({ socket: outer, ...insecure }), "secureConnect", peer.promise);
      });
    });
  },
  // The TLS socket takes over the handle of the socket that it wraps.
  "an accepted socket"(use) {
    const server = net.createServer(raw => {
      server.close();
      use(quiet(raw), () => new tls.TLSSocket(raw, { isServer: true, cert, key }), "secure", peer);
    });
    const peer = new Promise(resolve => {
      server.listen(0, "127.0.0.1", () => resolve(unrefedClient(server.address().port, false)));
    });
  },
  "a socket that still connects"(use) {
    const peer = Promise.withResolvers();
    const server = tls.createServer({ cert, key }, socket => {
      quiet(socket).unref();
      peer.resolve(socket);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const raw = quiet(net.connect(server.address().port, "127.0.0.1"));
      use(raw, () => tls.connect({ socket: raw, ...insecure }), "secureConnect", peer.promise);
    });
  },
};

// `unref` takes the wrap out of what keeps the process alive. ref() puts it back: only then does
// the process wait for what the peer sends next, and for the close behind it.
function rests(kind, when, unref = wrap => wrap.unref()) {
  kinds[kind]((raw, wrapIt, handshake, peer) => {
    const wrap = quiet(wrapIt());
    observe(`${kind}, ${when}`, wrap);
    const act = () => {
      unref(wrap);
      later.push(() => {
        wrap.ref();
        peer.then(socket => socket.end("bye"));
      });
    };
    if (when.includes("after the handshake")) wrap.once(handshake, act);
    else act();
  });
}

// The wrap keeps the process alive: the process waits for the handshake, for what the peer
// sends behind it, and for the close.
function holds(kind, what, act) {
  kinds[kind]((raw, wrapIt, handshake, peer) => {
    const wrap = quiet(act(raw, wrapIt));
    observe(`${kind}, ${what}`, wrap);
    peer.then(socket => socket.end("bye"));
  });
}

const groups = {
  // The TLS engine of these reads the wrapped stream.
  "engine, server side"() {
    rests("TLS in TLS, server side", "unref() in the tick of the wrap");
  },
  "engine, its handle"() {
    rests("TLS in TLS, server side", "_handle.unref() after the handshake", wrap => wrap._handle.unref());
  },
  "engine, client side"() {
    rests("TLS in TLS, client side", "unref() after the handshake");

    // Nothing below these two has a handle: ref() must not make the process wait for them.
    const events = (results["a pair of JS streams, ref()"] = []);
    const [serverSide, clientSide] = duplexPair();
    const server = quiet(new tls.TLSSocket(serverSide, { isServer: true, cert, key }));
    const client = quiet(tls.connect({ socket: clientSide, ...insecure }));
    server.ref();
    client.once("secureConnect", () => {
      events.push("secureConnect");
      client.ref();
      server.unref().ref();
    });
  },
  // These take over the handle of the socket that they wrap.
  "handle"() {
    rests("an accepted socket", "unref() in the tick of the wrap");
    rests("a socket that still connects", "unref() in the tick of the wrap");
  },
  "handle, unref() before the wrap"() {
    holds("an accepted socket", "unref() on it and ref() on the wrap in the tick of the wrap", (raw, wrapIt) => {
      raw.unref();
      return wrapIt().ref();
    });

    // unref() before the wrap holds for the wrap. Its reads stop when nothing reads it, and a
    // reader that comes later starts them again: that does not bring back what unref() took away.
    kinds["an accepted socket"]((raw, wrapIt, handshake, peer) => {
      raw.unref();
      const wrap = quiet(wrapIt());
      const events = observe("an accepted socket, unref() before the wrap and a late reader", wrap, false);
      // More than the wrap buffers.
      peer.then(socket => socket.write(Buffer.alloc(4 * 65536, "x")));
      // The process does not come to rest before the reads have stopped.
      (function untilReadsStop() {
        if (wrap.readableLength < wrap.readableHighWaterMark) setImmediate(untilReadsStop);
      })();
      last = () => {
        events.push("a reader");
        wrap.resume();
      };
    });
  },
};
groups[process.argv[2]]();
