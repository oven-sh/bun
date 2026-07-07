// RFC 5802 §3: AuthMessage signs the server-first/server-final bytes as received,
// including any extension attributes. A live PostgreSQL never sends extensions, so
// this scripted SCRAM server injects them and checks ClientProof against the RFC value.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { listeningServer, pgAuthenticationOk, pgInt32, pgRaw, pgReadyForQuery } from "./wire-frames";

const PASSWORD = "pw";
const ITERS = 4096;

const sha256 = (d: Buffer | string) => createHash("sha256").update(d).digest();
const hmac = (key: Buffer, data: Buffer | string) => createHmac("sha256", key).update(data).digest();

// PostgreSQL FE/BE §55.7 AuthenticationSASL: Byte1('R') Int32(len) Int32(10) String(mechanism)* Byte1(0)
const pgAuthenticationSASL = () => pgRaw("R", Buffer.concat([pgInt32(10), Buffer.from("SCRAM-SHA-256\0\0")]));
// AuthenticationSASLContinue: Byte1('R') Int32(len) Int32(11) Byte[n](server-first-message)
const pgAuthenticationSASLContinue = (msg: string) => pgRaw("R", Buffer.concat([pgInt32(11), Buffer.from(msg)]));
// AuthenticationSASLFinal: Byte1('R') Int32(len) Int32(12) Byte[n](server-final-message)
const pgAuthenticationSASLFinal = (msg: string) => pgRaw("R", Buffer.concat([pgInt32(12), Buffer.from(msg)]));

// Drive a full SCRAM-SHA-256 handshake: `firstExt` is appended to server-first after
// "i=N", `finalExt` to server-final after "v=<sig>". connect() resolving proves the
// client accepted the RFC-derived v= signature.
async function runScramHandshake(firstExt: string, finalExt: string): Promise<void> {
  const {
    promise: gotProofs,
    resolve: resolveProofs,
    reject,
  } = Promise.withResolvers<{
    clientProof: string;
    rfcProof: string;
  }>();

  const { port, server } = await listeningServer(socket => {
    let buf = Buffer.alloc(0);
    let sawStartup = false;
    let saslState = 0;
    let clientFirstBare = "";
    let serverFirst = "";
    let salted = Buffer.alloc(0);
    socket.on("error", reject);
    socket.on("close", () => {
      if (saslState < 2) reject(new Error("socket closed before SCRAM handshake completed"));
    });
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      try {
        for (;;) {
          if (!sawStartup) {
            // StartupMessage: Int32(len) Int32(protocol) ...; no type byte.
            if (buf.length < 4) return;
            const len = buf.readInt32BE(0);
            if (buf.length < len) return;
            buf = buf.subarray(len);
            sawStartup = true;
            socket.write(pgAuthenticationSASL());
            continue;
          }
          if (buf.length < 5) return;
          const len = buf.readInt32BE(1);
          if (buf.length < 1 + len) return;
          const type = String.fromCharCode(buf[0]);
          const body = buf.subarray(5, 1 + len);
          buf = buf.subarray(1 + len);
          if (type !== "p") continue;

          if (saslState === 0) {
            // SASLInitialResponse: String(mechanism) Int32(n) Byte[n](client-first-message)
            const z = body.indexOf(0);
            const n = body.readInt32BE(z + 1);
            const clientFirst = body.subarray(z + 5, z + 5 + n).toString();
            // gs2-header = [pny]["=" saslname],[authzid],
            clientFirstBare = clientFirst.replace(/^[nyp](=[^,]*)?,[^,]*,/, "");
            const clientNonce = /(?:^|,)r=([^,]*)/.exec(clientFirstBare)![1];
            const salt = randomBytes(18);
            salted = pbkdf2Sync(PASSWORD, salt, ITERS, 32, "sha256");
            serverFirst =
              `r=${clientNonce}${randomBytes(16).toString("base64")},` +
              `s=${salt.toString("base64")},i=${ITERS}${firstExt}`;
            socket.write(pgAuthenticationSASLContinue(serverFirst));
            saslState = 1;
          } else {
            // SASLResponse: client-final-message
            const finalMsg = body.toString();
            const pIdx = finalMsg.lastIndexOf(",p=");
            const withoutProof = finalMsg.slice(0, pIdx);
            const clientProof = finalMsg.slice(pIdx + 3);

            const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
            const clientKey = hmac(salted, "Client Key");
            const storedKey = sha256(clientKey);
            const clientSig = hmac(storedKey, authMessage);
            const rfcProof = Buffer.from(clientKey.map((b, i) => b ^ clientSig[i])).toString("base64");
            resolveProofs({ clientProof, rfcProof });

            const serverKey = hmac(salted, "Server Key");
            const serverSig = hmac(serverKey, authMessage).toString("base64");
            socket.write(
              Buffer.concat([
                pgAuthenticationSASLFinal(`v=${serverSig}${finalExt}`),
                pgAuthenticationOk(),
                pgReadyForQuery(),
              ]),
            );
            saslState = 2;
          }
        }
      } catch (e) {
        reject(e);
        socket.destroy();
      }
    });
  });

  const db = new SQL({
    url: `postgres://u:${PASSWORD}@127.0.0.1:${port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 5,
  });
  try {
    // Start the handshake first; then await whichever settles: the proof capture
    // (server saw client-final) or connect() rejecting earlier in the exchange.
    const connected = db.connect();
    connected.catch(() => {});
    const { clientProof, rfcProof } = await Promise.race([gotProofs, connected.then(() => gotProofs)]);
    expect(clientProof).toBe(rfcProof);
    // connect() resolving proves the client also accepted the server's RFC v= signature.
    await connected;
  } finally {
    await db.close({ timeout: 0 });
    await new Promise<void>(r => server.close(() => r()));
  }
}

describe("postgres SCRAM-SHA-256: RFC 5802 extension attributes", () => {
  test("canonical server-first / server-final (no extensions)", async () => {
    await runScramHandshake("", "");
  });

  test("server-first-message carrying an extension attribute", async () => {
    await runScramHandshake(",x=future-ext", "");
  });

  test("server-final-message carrying an extension attribute", async () => {
    await runScramHandshake("", ",x=future-ext");
  });

  test("both server-first and server-final carrying extension attributes", async () => {
    await runScramHandshake(",x=future-ext", ",x=future-ext");
  });
});
