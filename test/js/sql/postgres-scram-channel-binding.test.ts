// Fault-injection test: requires a server that picks its SASL mechanism list,
// terminates TLS with a known certificate, and sends malformed SCRAM frames,
// none of which a healthy container will do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Covers libpq's `channel_binding` connection parameter and SCRAM-SHA-256-PLUS
// (RFC 5802 channel binding with the RFC 5929 tls-server-end-point type):
// - the client selects its mechanism from the server's list and binds to the
//   TLS server certificate when the server offers SCRAM-SHA-256-PLUS;
// - `channel_binding=require` refuses plaintext, a list without -PLUS, and any
//   non-SASL authentication, instead of silently accepting the keyword;
// - the keyword is consumed by the client, not forwarded in the StartupMessage;
// - a server-first-message carrying the `m=` mandatory extension is rejected.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs } from "harness";
import { createHash, createHmac, pbkdf2Sync, randomBytes, X509Certificate } from "node:crypto";
import type net from "node:net";
import tls from "node:tls";
import {
  listeningServer,
  pgAuthenticationCleartextPassword,
  pgAuthenticationMD5Password,
  pgAuthenticationOk,
  pgAuthenticationSASL,
  pgAuthenticationSASLContinue,
  pgAuthenticationSASLFinal,
  pgErrorResponse,
  pgParseSASLInitialResponse,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

const USER = "u";
const PASSWORD = "pw";
const ITERATIONS = 4096;

// RFC 5929 §4.1: the certificate's DER hashed with the digest of its signature
// algorithm. The harness certificate is sha256WithRSAEncryption, so this is the
// SHA-256 fingerprint.
const CERT_HASH = Buffer.from(new X509Certificate(certs.cert).fingerprint256.replaceAll(":", ""), "hex");

const base64 = (b: Buffer | string) => Buffer.from(b).toString("base64");

interface ScramServerOptions {
  /** Answer SSLRequest with 'S' and run the rest over TLS with the harness certificate. */
  tls?: boolean;
  /** First authentication frame after the StartupMessage. Defaults to AuthenticationSASL(mechanisms). */
  first?: Buffer;
  mechanisms?: string[];
  /** Attributes appended to the server-first-message (e.g. ",m=ext"). */
  serverFirstExtra?: string;
}

interface ScramServerLog {
  /** StartupMessage parameters as the server received them. */
  startup: Record<string, string>;
  /** SASLInitialResponse, or null when the client never sent one. */
  initial: { mechanism: string; data: string } | null;
  /** client-final-message, or null when the client never sent one. */
  clientFinal: string | null;
  /** Whether the server verified the client proof. */
  proofOk: boolean | null;
}

/**
 * A Postgres mock that speaks the server side of SCRAM-SHA-256 and
 * SCRAM-SHA-256-PLUS (node:crypto), verifies the client proof against the
 * channel binding it expects from the client's GS2 header, and answers with the
 * server signature, AuthenticationOk and ReadyForQuery.
 */
async function scramServer(opts: ScramServerOptions = {}) {
  const mechanisms = opts.mechanisms ?? ["SCRAM-SHA-256-PLUS", "SCRAM-SHA-256"];
  const first = opts.first ?? pgAuthenticationSASL(mechanisms);
  const log: ScramServerLog = { startup: {}, initial: null, clientFinal: null, proofOk: null };
  const sockets = new Set<net.Socket>();

  const { port, server } = await listeningServer(raw => {
    sockets.add(raw);
    raw.on("error", () => {});
    raw.on("close", () => sockets.delete(raw));

    let buffered = Buffer.alloc(0);
    let stream: net.Socket = raw;
    let phase: "startup" | "sasl-initial" | "sasl-final" | "done" = "startup";
    let clientFirstBare = "";
    let serverFirst = "";
    let saltedPassword = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (phase === "startup") {
        if (buffered.length < 8) return;
        const len = buffered.readInt32BE(0);
        const code = buffered.readInt32BE(4);
        if (code === 80877103) {
          // SSLRequest
          buffered = buffered.subarray(8);
          if (opts.tls) {
            raw.write(pgSSLResponse("S"));
            stream.removeListener("data", onData);
            const secure = new tls.TLSSocket(raw, { isServer: true, key: certs.key, cert: certs.cert });
            secure.on("error", () => {});
            secure.on("data", onData);
            stream = secure;
          } else {
            raw.write(pgSSLResponse("N"));
          }
          if (buffered.length === 0) return;
        }
        if (buffered.length < len) return;
        // StartupMessage: Int32(len) Int32(196608) (String key String value)* Byte1(0)
        const params = buffered
          .subarray(8, len - 1)
          .toString("latin1")
          .split("\0");
        for (let i = 0; i + 1 < params.length; i += 2) log.startup[params[i]] = params[i + 1];
        buffered = buffered.subarray(len);
        phase = "sasl-initial";
        stream.write(first);
      }
      buffered = pgReadFrontendMessages(buffered, (type, body) => {
        if (String.fromCharCode(type) !== "p") return;
        if (opts.first) {
          // A custom first frame (md5 / cleartext): accept whatever password
          // message comes back so a client that answers it connects at once.
          phase = "done";
          stream.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
          return;
        }
        if (phase === "sasl-initial") {
          const initial = pgParseSASLInitialResponse(body);
          log.initial = initial;
          // RFC 5802 §7: gs2-header = gs2-cbind-flag "," [authzid] ","
          const headerEnd = initial.data.indexOf(",", initial.data.indexOf(",") + 1) + 1;
          clientFirstBare = initial.data.slice(headerEnd);
          const clientNonce = /(?:^|,)r=([^,]*)/.exec(clientFirstBare)![1];
          const salt = randomBytes(16);
          serverFirst = `r=${clientNonce}${base64(randomBytes(18))},s=${base64(salt)},i=${ITERATIONS}${opts.serverFirstExtra ?? ""}`;
          saltedPassword = pbkdf2Sync(PASSWORD, salt, ITERATIONS, 32, "sha256");
          phase = "sasl-final";
          stream.write(pgAuthenticationSASLContinue(serverFirst));
          return;
        }
        if (phase === "sasl-final") {
          const clientFinal = body.toString("latin1");
          log.clientFinal = clientFinal;
          const withoutProof = clientFinal.slice(0, clientFinal.lastIndexOf(",p="));
          const proof = Buffer.from(/,p=([^,]*)$/.exec(clientFinal)![1], "base64");
          const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
          const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
          const storedKey = createHash("sha256").update(clientKey).digest();
          const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
          const recoveredKey = Buffer.from(clientKey.map((b, i) => b ^ clientSignature[i]));
          log.proofOk = recoveredKey.equals(proof);
          phase = "done";
          if (!log.proofOk) {
            stream.write(
              pgErrorResponse({ S: "FATAL", C: "28P01", M: `password authentication failed for user "${USER}"` }),
            );
            return;
          }
          const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
          const serverSignature = createHmac("sha256", serverKey).update(authMessage).digest();
          stream.write(
            Buffer.concat([
              pgAuthenticationSASLFinal(`v=${base64(serverSignature)}`),
              pgAuthenticationOk(),
              pgReadyForQuery(),
            ]),
          );
        }
      });
    };
    raw.on("data", onData);
  });

  return {
    port,
    log,
    async [Symbol.asyncDispose]() {
      for (const s of sockets) s.destroy();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

/** Connect once; resolve to the error code, or "CONNECTED". */
async function connectOutcome(url: string, options: Record<string, unknown> = {}): Promise<string> {
  const db = new SQL({ url, max: 1, connectionTimeout: 30, ...options });
  try {
    await db.connect();
    return "CONNECTED";
  } catch (e: any) {
    return e?.code ?? String(e);
  } finally {
    await db.close({ timeout: 0 });
  }
}

/** c= is base64(gs2-header || cbind-data). */
const cbind = (header: string, data: Buffer = Buffer.alloc(0)) => base64(Buffer.concat([Buffer.from(header), data]));

test.concurrent("channel_binding=require refuses a plaintext connection before answering SASL", async () => {
  await using server = await scramServer({ tls: false });
  const outcome = await connectOutcome(
    `postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?channel_binding=require`,
  );
  expect({ outcome, initial: server.log.initial, forwarded: "channel_binding" in server.log.startup }).toEqual({
    outcome: "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
    initial: null,
    forwarded: false,
  });
});

test.concurrent("channel_binding=require refuses a server that offers only SCRAM-SHA-256 over TLS", async () => {
  await using server = await scramServer({ tls: true, mechanisms: ["SCRAM-SHA-256"] });
  const outcome = await connectOutcome(
    `postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=require&channel_binding=require`,
  );
  expect({ outcome, initial: server.log.initial }).toEqual({
    outcome: "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
    initial: null,
  });
});

test.concurrent.each(["md5", "cleartext", "trust"])(
  "channel_binding=require refuses %s authentication over TLS",
  async method => {
    const first = {
      md5: pgAuthenticationMD5Password(),
      cleartext: pgAuthenticationCleartextPassword(),
      trust: Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]),
    }[method]!;
    await using server = await scramServer({ tls: true, first });
    const outcome = await connectOutcome(
      `postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=require&channel_binding=require`,
    );
    expect(outcome).toBe("ERR_POSTGRES_CHANNEL_BINDING_REQUIRED");
  },
);

test.concurrent("SCRAM-SHA-256-PLUS binds to the server certificate when the server offers it", async () => {
  await using server = await scramServer({ tls: true });
  const outcome = await connectOutcome(`postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=require`);
  const { initial, clientFinal, proofOk } = server.log;
  expect({
    outcome,
    mechanism: initial?.mechanism,
    gs2: initial?.data.slice(0, "p=tls-server-end-point,,".length),
    c: /^c=([^,]*)/.exec(clientFinal ?? "")?.[1],
    proofOk,
  }).toEqual({
    outcome: "CONNECTED",
    mechanism: "SCRAM-SHA-256-PLUS",
    gs2: "p=tls-server-end-point,,",
    c: cbind("p=tls-server-end-point,,", CERT_HASH),
    proofOk: true,
  });
});

test.concurrent("channel_binding=require connects when the server offers SCRAM-SHA-256-PLUS", async () => {
  await using server = await scramServer({ tls: true });
  const outcome = await connectOutcome(
    `postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=require&channel_binding=require`,
  );
  expect({ outcome, mechanism: server.log.initial?.mechanism, proofOk: server.log.proofOk }).toEqual({
    outcome: "CONNECTED",
    mechanism: "SCRAM-SHA-256-PLUS",
    proofOk: true,
  });
});

test.concurrent("channel_binding=disable uses SCRAM-SHA-256 with the n,, header over TLS", async () => {
  await using server = await scramServer({ tls: true });
  const outcome = await connectOutcome(
    `postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=require&channel_binding=disable`,
  );
  const { initial, clientFinal, proofOk } = server.log;
  expect({
    outcome,
    mechanism: initial?.mechanism,
    gs2: initial?.data.slice(0, 3),
    c: /^c=([^,]*)/.exec(clientFinal ?? "")?.[1],
    proofOk,
  }).toEqual({ outcome: "CONNECTED", mechanism: "SCRAM-SHA-256", gs2: "n,,", c: cbind("n,,"), proofOk: true });
});

test.concurrent("a TLS client advertises y,, when the server does not offer SCRAM-SHA-256-PLUS", async () => {
  // RFC 5802 §6: "y" lets a server that did offer -PLUS detect a downgrade.
  await using server = await scramServer({ tls: true, mechanisms: ["SCRAM-SHA-256"] });
  const outcome = await connectOutcome(`postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=require`);
  const { initial, clientFinal, proofOk } = server.log;
  expect({
    outcome,
    mechanism: initial?.mechanism,
    gs2: initial?.data.slice(0, 3),
    c: /^c=([^,]*)/.exec(clientFinal ?? "")?.[1],
    proofOk,
  }).toEqual({ outcome: "CONNECTED", mechanism: "SCRAM-SHA-256", gs2: "y,,", c: cbind("y,,"), proofOk: true });
});

test.concurrent("a plaintext client keeps the n,, header and SCRAM-SHA-256", async () => {
  await using server = await scramServer({ tls: false });
  const outcome = await connectOutcome(`postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=disable`);
  const { initial, clientFinal, proofOk } = server.log;
  expect({
    outcome,
    mechanism: initial?.mechanism,
    gs2: initial?.data.slice(0, 3),
    c: /^c=([^,]*)/.exec(clientFinal ?? "")?.[1],
    proofOk,
  }).toEqual({ outcome: "CONNECTED", mechanism: "SCRAM-SHA-256", gs2: "n,,", c: cbind("n,,"), proofOk: true });
});

test.concurrent("a SASL list with no supported mechanism fails instead of guessing SCRAM-SHA-256", async () => {
  await using server = await scramServer({ tls: false, mechanisms: ["SCRAM-SHA-1", "GSSAPI"] });
  const outcome = await connectOutcome(`postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=disable`);
  expect({ outcome, initial: server.log.initial }).toEqual({
    outcome: "ERR_POSTGRES_SASL_NO_KNOWN_MECHANISM",
    initial: null,
  });
});

test.concurrent("a server-first-message with the m= mandatory extension is rejected", async () => {
  // RFC 5802 §5.1: a client that does not understand `m=` MUST fail.
  await using server = await scramServer({ tls: false, serverFirstExtra: ",m=ext" });
  const outcome = await connectOutcome(`postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db?sslmode=disable`);
  expect({ outcome, clientFinal: server.log.clientFinal }).toEqual({
    outcome: "ERR_POSTGRES_INVALID_MESSAGE",
    clientFinal: null,
  });
});

test.concurrent("an unknown channel_binding value is rejected", () => {
  expect(() => new SQL(`postgres://${USER}:${PASSWORD}@127.0.0.1:1/db?channel_binding=maybe`)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
});

test.concurrent("PGCHANNELBINDING=require from the environment is honoured", async () => {
  await using server = await scramServer({ tls: false });
  const env: Record<string, string> = { ...bunEnv };
  for (const key of Object.keys(env)) {
    if (/^(PG|PG_|POSTGRES_|DATABASE_|TLS_)/.test(key)) delete env[key];
  }
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        import { SQL } from "bun";
        const sql = new SQL({ url: "postgres://${USER}:${PASSWORD}@127.0.0.1:${server.port}/db", max: 1, connectionTimeout: 5 });
        try {
          await sql.connect();
          console.log("CONNECTED");
        } catch (e) {
          console.log(e?.code ?? String(e));
        } finally {
          await sql.close({ timeout: 0 }).catch(() => {});
        }
      `,
    ],
    env: { ...env, PGCHANNELBINDING: "require" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ERR_POSTGRES_CHANNEL_BINDING_REQUIRED");
  expect(exitCode).toBe(0);
});
