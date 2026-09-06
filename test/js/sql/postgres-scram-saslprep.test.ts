// Fault-injection test: needs a SCRAM-SHA-256 server whose stored verifier is
// keyed on a known SASLprep result, which a real container cannot expose on
// demand. DO NOT COPY THIS PATTERN for behavior a real server can produce.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts.
//
// PostgreSQL derives the SCRAM verifier from SASLprep(password) (RFC 4013:
// map non-ASCII spaces to U+0020, drop "map to nothing" code points such as
// the soft hyphen, then NFKC). If SASLprep rejects the password (a prohibited
// code point or a bidi violation), the server and libpq both use the raw
// password. The client must apply the same rule before PBKDF2, or a role
// whose password is changed by SASLprep can never authenticate.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  listeningServer,
  pgAuthenticationOk,
  pgAuthenticationSASL,
  pgErrorResponse,
  pgInt32,
  pgRaw,
  pgReadFrontendMessages,
  pgReadyForQuery,
} from "./wire-frames";

const SSL_REQUEST_CODE = 80877103;
const ITERATIONS = 4096;

function hmac(key: Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * A minimal SCRAM-SHA-256 server (RFC 5802, RFC 7677) whose verifier is built
 * from `storedPassword`, the string PostgreSQL would feed to PBKDF2 after
 * pg_saslprep. Resolves with the server-side outcome once the exchange ends.
 */
async function scramServer(storedPassword: string) {
  const salt = randomBytes(16);
  const saltedPassword = pbkdf2Sync(Buffer.from(storedPassword, "utf8"), salt, ITERATIONS, 32, "sha256");
  const clientKey = hmac(saltedPassword, "Client Key");
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = hmac(saltedPassword, "Server Key");

  const sockets = new Set<import("node:net").Socket>();
  const { port, server } = await listeningServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));

    let buf = Buffer.alloc(0);
    let sawStartup = false;
    let clientFirstBare = "";
    let serverFirst = "";

    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!sawStartup) {
        // StartupMessage / SSLRequest: Int32(len) Int32(code) ...; no type byte.
        if (buf.length < 8) return;
        const len = buf.readInt32BE(0);
        if (buf.length < len) return;
        const code = buf.readInt32BE(4);
        buf = buf.subarray(len);
        if (code === SSL_REQUEST_CODE) {
          socket.write("N");
          return;
        }
        sawStartup = true;
        socket.write(pgAuthenticationSASL(["SCRAM-SHA-256"]));
      }
      buf = pgReadFrontendMessages(buf, (type, body) => {
        if (type !== "p".charCodeAt(0)) return;
        if (clientFirstBare === "") {
          // SASLInitialResponse: String(mechanism) Int32(len) Byte[len]
          const nul = body.indexOf(0);
          const dataLen = body.readInt32BE(nul + 1);
          const clientFirst = body.subarray(nul + 5, nul + 5 + dataLen).toString("utf8");
          // "n,,n=*,r=<nonce>": gs2 header is the first two commas.
          clientFirstBare = clientFirst.slice(clientFirst.indexOf(",,") + 2);
          const clientNonce = /(?:^|,)r=([^,]+)/.exec(clientFirstBare)![1];
          const serverNonce = clientNonce + randomBytes(18).toString("base64");
          serverFirst = `r=${serverNonce},s=${salt.toString("base64")},i=${ITERATIONS}`;
          socket.write(pgRaw("R", Buffer.concat([pgInt32(11), Buffer.from(serverFirst, "utf8")])));
          return;
        }
        // SASLResponse: client-final-message "c=biws,r=<nonce>,p=<proof>"
        const clientFinal = body.toString("utf8");
        const proofAt = clientFinal.lastIndexOf(",p=");
        const clientFinalWithoutProof = clientFinal.slice(0, proofAt);
        const proof = Buffer.from(clientFinal.slice(proofAt + 3), "base64");
        const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
        const clientSignature = hmac(storedKey, authMessage);
        const recoveredClientKey = Buffer.from(proof.map((b, i) => b ^ clientSignature[i]));
        const ok = createHash("sha256").update(recoveredClientKey).digest().equals(storedKey);
        if (!ok) {
          socket.end(pgErrorResponse({ S: "FATAL", C: "28P01", M: 'password authentication failed for user "u"' }));
          return;
        }
        const serverSignature = hmac(serverKey, authMessage).toString("base64");
        socket.write(
          Buffer.concat([
            pgRaw("R", Buffer.concat([pgInt32(12), Buffer.from(`v=${serverSignature}`, "utf8")])),
            pgAuthenticationOk(),
            pgReadyForQuery(),
          ]),
        );
      });
    });
  });

  return {
    port,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

async function connectWith(password: string, storedPassword: string) {
  const srv = await scramServer(storedPassword);
  const db = new SQL({
    hostname: "127.0.0.1",
    port: srv.port,
    username: "u",
    password,
    database: "d",
    tls: false,
    max: 1,
    connectionTimeout: 30,
  });
  try {
    await db.connect();
    return "ok";
  } catch (e: any) {
    return `${e.code} ${e.errno}`;
  } finally {
    await db.close({ timeout: 0 });
    await srv.close();
  }
}

// password: what the user passes to `new SQL()`.
// stored: what PostgreSQL's pg_saslprep produced when the role was created.
const cases = [
  { name: "NFKC compatibility mapping (U+00AA -> a)", password: "x\u00AAy", stored: "xay" },
  { name: "soft hyphen (U+00AD) is mapped to nothing", password: "soft\u00ADhyphen", stored: "softhyphen" },
  { name: "no-break space (U+00A0) becomes U+0020", password: "no\u00A0break", stored: "no break" },
  { name: "NFD input composes to NFC", password: "pa\u0308ss", stored: "p\u00E4ss" },
  // U+200B is in both C.1.2 and B.1. pg_saslprep checks C.1.2 first.
  { name: "zero width space (U+200B) becomes U+0020", password: "a\u200Bb", stored: "a b" },
  { name: "ASCII is unchanged", password: "a,b=c pass", stored: "a,b=c pass" },
  { name: "NFC unicode is unchanged", password: "p\u00E4ss", stored: "p\u00E4ss" },
  { name: "emoji is unchanged", password: "\u{1F600}pw", stored: "\u{1F600}pw" },
  // SASLprep rejects these. PostgreSQL then stores the raw password, so the
  // client must send the raw password too, not a half-normalized one.
  {
    name: "prohibited control character keeps the raw password",
    password: "bell\u0007\u00AA",
    stored: "bell\u0007\u00AA",
  },
  {
    name: "bidi violation (RandALCat + LCat) keeps the raw password",
    password: "\u05D0\u00AAa",
    stored: "\u05D0\u00AAa",
  },
  { name: "RandALCat only is normalized", password: "\u05D0\u00AD\u05D1", stored: "\u05D0\u05D1" },
  // RFC 3454 table A.1 is "unassigned in Unicode 3.2". PostgreSQL uses that
  // table as is, so an emoji makes the whole password raw.
  {
    name: "code point assigned after Unicode 3.2 keeps the raw password",
    password: "\u{1F600}\u00ADpw",
    stored: "\u{1F600}\u00ADpw",
  },
  // U+FE12 is NFKC-mapped to U+3002 (Unicode 1.1), but pg_saslprep checks the
  // input before normalization, so the Unicode 4.1 input code point rejects it.
  { name: "vertical form U+FE12 (Unicode 4.1) keeps the raw password", password: "a\uFE12b", stored: "a\uFE12b" },
  // pg_saslprep rejects a password that maps to nothing.
  { name: "a lone soft hyphen keeps the raw password", password: "\u00AD", stored: "\u00AD" },
];

test.concurrent.each(cases)("postgres SCRAM-SHA-256 applies SASLprep: $name", async ({ password, stored }) => {
  expect(await connectWith(password, stored)).toBe("ok");
});

test.concurrent("postgres SCRAM-SHA-256 wrong password is rejected by the server", async () => {
  expect(await connectWith("wrong", "right")).toBe("ERR_POSTGRES_SERVER_ERROR 28P01");
});
