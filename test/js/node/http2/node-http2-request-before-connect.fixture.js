// The ways ("doors") in which a client gets a listener that runs when its http2 session connects.
// node-http2-request-before-connect.test.ts uses the doors in its own process.
//
// Run as a script, this file opens one door with a listener that throws, and makes a request on the
// line behind the door. Run under Node.js and under Bun.
//   argv[2]: JSON of { door, target: { url, tlsOptions }, survive }
const { writeSync } = require("node:fs");
const http2 = require("node:http2");
const net = require("node:net");

const doors = {
  "http2.connect(url, options, listener)": {
    secure: true,
    open: (target, listener) => http2.connect(target.url, target.tlsOptions, listener),
  },
  "session.on('connect', listener)": {
    secure: true,
    open: (target, listener) => http2.connect(target.url, target.tlsOptions).on("connect", listener),
  },
  "session.socket.on('secureConnect', listener)": {
    secure: true,
    open(target, listener) {
      const session = http2.connect(target.url, target.tlsOptions);
      session.socket.on("secureConnect", listener);
      return session;
    },
  },
  "cleartext http2.connect(url, listener)": {
    secure: false,
    open: (target, listener) => http2.connect(target.url, listener),
  },
  "createConnection with a net socket that still connects, socket.on('connect', listener)": {
    secure: false,
    open(target, listener) {
      const { hostname, port } = new URL(target.url);
      const socket = net.connect(Number(port), hostname);
      const session = http2.connect(target.url, { createConnection: () => socket });
      socket.on("connect", listener);
      return session;
    },
  },
};

module.exports = { doors };

if (require.main === module) {
  const { door, target, survive } = JSON.parse(process.argv[2]);
  // Synchronous, so that a line is not lost when the process ends at the throw.
  const print = line => writeSync(1, `${line}\n`);

  if (survive) process.on("uncaughtException", err => print(`uncaught: ${err.message}`));

  const session = doors[door].open(target, () => {
    print("listener: throws");
    throw new Error("PEER REFUSED");
  });
  session.on("error", err => print(`session error: ${err.message}`));

  const req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
  req.on("error", () => {});
  req.on("close", () => session.close());
  req.resume();
  process.on("exit", () => print(`at exit: the request is ${req.pending ? "pending" : "submitted"}`));

  if (survive) {
    session.on("remoteSettings", () => {
      const later = session.request({ ":path": "/later" });
      later.on("response", headers => {
        print(`later response: ${headers[":status"]}`);
        session.destroy();
      });
      later.resume();
    });
  }
}
