// argv: key.pem cert.pem <refused> <accepted>
//
// The listen callback destroys the first <refused> sessions and keeps the next
// <accepted>. The client connects once for each, one after the other. Prints
// one JSON line: for each kept session, the labels of the key log lines its
// `onkeylog` got and the number of distinct client randoms in them.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen, type SessionOptions } from "node:quic";

const [keyPath, certPath, refusedArg, acceptedArg] = process.argv.slice(2);
const refused = Number(refusedArg);
const accepted = Number(acceptedArg);
const transportParams = { maxIdleTimeout: 1 };

let announced = 0;
const logs = new Map<object, string[][]>();

const server = await listen(
  (session: any) => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    if (++announced <= refused) {
      session.destroy();
      return;
    }
    logs.set(session, []);
  },
  {
    sni: { "*": { keys: [createPrivateKey(readFileSync(keyPath))], certs: [readFileSync(certPath)] } },
    alpn: ["handshake-test"],
    keylog: true,
    transportParams,
    // An NSS key log line is "<label> <client random> <secret>".
    onkeylog(this: object, line: string) {
      logs.get(this)?.push(line.trim().split(" "));
    },
  },
);

const options = {
  alpn: "handshake-test",
  servername: "localhost",
  verifyPeer: "manual",
  transportParams,
  onerror() {},
} as SessionOptions;

// `closed` settles once the client learns that the server dropped the
// connection, so the server has freed the handshake's TLS state by then.
for (let i = 0; i < refused; i++) {
  const session = await connect(server.address!, options);
  await Promise.allSettled([session.closed]);
}

for (let i = 0; i < accepted; i++) {
  const session = await connect(server.address!, options);
  await session.opened;
}
// A server session has its key log before its `opened` settles.
await Promise.all([...logs.keys()].map((session: any) => session.opened));

console.log(
  JSON.stringify(
    [...logs.values()].map(lines => ({
      labels: lines.map(fields => fields[0]).sort(),
      clientRandoms: new Set(lines.map(fields => fields[1])).size,
    })),
  ),
);
process.exit(0);
