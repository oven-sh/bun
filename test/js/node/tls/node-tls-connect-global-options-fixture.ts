// globalThis is the options of TLSSocket#connect(). Prints whether the callback's `this` was globalThis at each handshake.
// A file, because `bun -e` defines the builtin modules as globals and `options.path` would be node:path.
import { once } from "node:events";
import fs from "node:fs";
import tls from "node:tls";

const ca = fs.readFileSync(process.env.CA_FILE!);
const options = globalThis as any;
options.host = "127.0.0.1";
options.port = Number(process.env.SERVER_PORT);
const receivers: boolean[] = [];
options.checkServerIdentity = function (this: unknown) {
  receivers.push(this === globalThis);
};
for (let i = 0; i < 3; i++) {
  // @ts-expect-error @types/node requires a socket
  const socket = new tls.TLSSocket(undefined, { ca });
  socket.connect(options);
  await once(socket, "secureConnect");
  socket.destroy();
}
console.log(JSON.stringify(receivers));
