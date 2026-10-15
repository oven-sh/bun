// An http2 secure server that gets its connection through emit("connection", rawSocket).
// session.unref() takes that connection out of what keeps the process alive, and session.ref()
// puts it back: Http2Session passes both to its socket, and the TLS socket passes them to the
// handle of the raw socket.
//
// The client is another process. This one prints its port, then "ref" when it has come to rest
// and has ref'd the session again, then what it saw. It has no timer and calls no
// process.exit(): it must exit by itself when the client has closed the session.
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const cert = fs.readFileSync(path.join(keys, "agent1-cert.pem"));
const key = fs.readFileSync(path.join(keys, "agent1-key.pem"));

const events = [];
// These run one at a time, each when nothing keeps the process alive.
const later = [];
process.on("beforeExit", () => {
  events.push("at rest");
  later.shift()?.();
});
process.on("exit", () => console.log(JSON.stringify(events)));

const h2Server = http2.createSecureServer({ cert, key });
h2Server.on("session", session => {
  netServer.close();
  session.on("close", () => events.push("session close"));
  h2Server.once("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
    stream.on("close", () => {
      session.unref();
      later.push(() => {
        // The process waits for the client's close again.
        session.ref();
        console.log("ref");
      });
    });
  });
});

const netServer = net.createServer(rawSocket => h2Server.emit("connection", rawSocket));
netServer.listen(0, "127.0.0.1", () => console.log(netServer.address().port));
