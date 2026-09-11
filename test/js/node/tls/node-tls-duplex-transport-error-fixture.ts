// Wraps a Duplex with tls.connect() and destroys the Duplex with an error.
// WHEN=early destroys it in the tick of the upgrade, before the TLS engine
// exists. WHEN=late destroys it once the engine has written its ClientHello.
// Prints the 'error' and 'close' events that the TLS socket emitted.
import { Duplex } from "node:stream";
import tls from "node:tls";

const when = process.env.WHEN;
const seen: string[] = [];
let started = false;

const transport = new Duplex({
  read() {},
  write(_chunk, _encoding, callback) {
    callback();
    if (started) return;
    started = true;
    if (when === "late") process.nextTick(kill);
  },
});

function kill() {
  transport.destroy(new Error("transport failed"));
}

const socket = tls.connect({ socket: transport, rejectUnauthorized: false });
socket.on("error", err => seen.push(`error:${err.message}`));
socket.on("close", () => {
  seen.push("close");
  console.log(seen.join("|"));
});

if (when === "early") kill();
