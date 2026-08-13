// Fault-injection test: the iteration count in the SCRAM server-first-message is
// chosen by the server. The postgres:15 container always advertises 4096;
// PostgreSQL 16+ advertises whatever `scram_iterations` was when the role's
// password was set (as low as 1), and only a hostile server or MITM advertises
// a huge value. A mock is the only way to drive both ends of the range.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// The client used to reject any server-first with i outside 4096..=10_000_000
// as ERR_POSTGRES_INVALID_MESSAGE before sending a proof, so roles created
// under a lower `scram_iterations` could never log in, although RFC 5802 only
// requires i >= 1 and libpq accepts exactly that. Any i >= 1 up to the cap is
// now accepted; above the cap the client refuses to run PBKDF2 and says why.
import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { createHash, createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import {
  listeningServer,
  pgAuthenticationOk,
  pgAuthenticationSASL,
  pgAuthenticationSASLContinue,
  pgAuthenticationSASLFinal,
  pgErrorResponse,
  pgParseSASLInitialResponse,
  pgParseStartupMessage,
  pgReadFrontendMessages,
  pgReadyForQuery,
} from "./wire-frames";

const PASSWORD = "bun_sql_test_scram";
const SALT = Buffer.from("bun-scram-test-salt");

/** What the mock saw on one connection, resolved once the client's socket closes. */
type Exchange = {
  /** SASLResponse (client-final-message) frames received after server-first was sent. */
  proofs: number;
  /** Whether the proof in the first SASLResponse verified against `PASSWORD` at the advertised i. */
  proofValid: boolean | null;
};

// One SCRAM-SHA-256 server for the whole file. Each connection picks the
// iteration count the server advertises through its user name (`i<N>`), so the
// tests below can run concurrently and look up their own exchange afterwards.
const exchanges = new Map<string, PromiseWithResolvers<Exchange>>();
function exchangeFor(user: string): PromiseWithResolvers<Exchange> {
  let entry = exchanges.get(user);
  if (!entry) exchanges.set(user, (entry = Promise.withResolvers<Exchange>()));
  return entry;
}
/** How many times each user has sent a StartupMessage, i.e. how often the pool dialed. */
const startupsByUser = new Map<string, number>();

const { port, server } = await listeningServer(socket => {
  const exchange: Exchange = { proofs: 0, proofValid: null };
  let buffered = Buffer.alloc(0);
  let user: string | undefined;
  let iterations = 0;
  let clientFirstBare: string | undefined;
  let serverFirst: string | undefined;

  socket.on("error", () => {});
  socket.on("close", () => {
    if (user !== undefined) exchangeFor(user).resolve(exchange);
  });
  socket.on("data", chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    if (user === undefined) {
      const startup = pgParseStartupMessage(buffered);
      if (!startup) return;
      user = startup.params.user;
      startupsByUser.set(user, (startupsByUser.get(user) ?? 0) + 1);
      iterations = Number(user.slice(1));
      buffered = startup.rest;
      socket.write(pgAuthenticationSASL());
    }
    buffered = pgReadFrontendMessages(buffered, (type, body) => {
      if (type !== 0x70 /* 'p' */) return;

      if (clientFirstBare === undefined) {
        // RFC 5802 §7: client-first-message = gs2-header client-first-message-bare,
        // and the bare part is what goes into AuthMessage.
        const { clientFirstMessage } = pgParseSASLInitialResponse(body);
        clientFirstBare = clientFirstMessage.slice(clientFirstMessage.indexOf(",,") + 2);
        const clientNonce = clientFirstBare
          .split(",")
          .find(attr => attr.startsWith("r="))!
          .slice(2);
        serverFirst = `r=${clientNonce}mock-server-nonce,s=${SALT.toString("base64")},i=${iterations}`;
        socket.write(pgAuthenticationSASLContinue(serverFirst));
        return;
      }

      exchange.proofs++;
      if (exchange.proofs > 1) return;
      // client-final-message = client-final-message-without-proof ",p=" base64(ClientProof)
      const clientFinal = body.toString("utf-8");
      const proofAt = clientFinal.lastIndexOf(",p=");
      const clientFinalWithoutProof = clientFinal.slice(0, proofAt);
      const proof = Buffer.from(clientFinal.slice(proofAt + 3), "base64");

      // RFC 5802 §3, with the same i the server advertised.
      const saltedPassword = pbkdf2Sync(PASSWORD, SALT, iterations, 32, "sha256");
      const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
      const storedKey = createHash("sha256").update(clientKey).digest();
      const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
      const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
      const expectedProof = Buffer.from(clientKey.map((byte, i) => byte ^ clientSignature[i]));
      exchange.proofValid = proof.length === expectedProof.length && timingSafeEqual(proof, expectedProof);
      if (!exchange.proofValid) {
        socket.end(
          pgErrorResponse({ S: "FATAL", C: "28P01", M: `mock: client proof does not verify at i=${iterations}` }),
        );
        return;
      }
      const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
      const serverSignature = createHmac("sha256", serverKey).update(authMessage).digest();
      socket.write(
        Buffer.concat([
          pgAuthenticationSASLFinal(`v=${serverSignature.toString("base64")}`),
          pgAuthenticationOk(),
          pgReadyForQuery(),
        ]),
      );
    });
  });
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

/** Connect as user `i<iterations>`; returns connect()'s outcome and what the mock saw. */
async function handshake(iterations: number) {
  const user = `i${iterations}`;
  const db = new SQL({
    url: `postgres://${user}:${PASSWORD}@127.0.0.1:${port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 30,
  });
  let error: any = null;
  try {
    await db.connect();
  } catch (e) {
    error = e;
  } finally {
    await db.close({ timeout: 0 });
  }
  const { proofs, proofValid } = await exchangeFor(user).promise;
  return {
    error: error && { name: error.name, code: error.code, message: error.message },
    proofs,
    proofValid,
  };
}

// 1 is the smallest value PostgreSQL 16+ `scram_iterations` allows; 4095 and
// 4096 straddle the old lower bound, 4096 being what every PostgreSQL <= 15
// server sends.
test.concurrent.each([1, 1000, 4095, 4096])(
  "postgres: SCRAM-SHA-256 authenticates when server-first says i=%d",
  async iterations => {
    expect(await handshake(iterations)).toEqual({ error: null, proofs: 1, proofValid: true });
  },
);

// 10_000_001 is the first refused value; 2_147_483_647 is the largest value a
// real server's `scram_iterations` can hold. Neither may reach PBKDF2: the
// client must refuse before sending a proof, naming both numbers.
test.concurrent.each([10_000_001, 2_147_483_647])(
  "postgres: SCRAM-SHA-256 refuses server-first i=%d without computing a proof",
  async iterations => {
    expect(await handshake(iterations)).toEqual({
      error: {
        name: "PostgresError",
        code: "ERR_POSTGRES_SASL_ITERATION_COUNT_TOO_HIGH",
        message: `SCRAM-SHA-256 iteration count ${iterations} exceeds the supported maximum of 10000000`,
      },
      proofs: 0,
      proofValid: null,
    });
  },
);

// RFC 5802 §5.1 requires a positive iteration count (libpq: "malformed SCRAM
// message (invalid iteration count)"), so 0 is still a protocol error.
test.concurrent("postgres: SCRAM-SHA-256 rejects server-first i=0 as a malformed message", async () => {
  const { error, proofs } = await handshake(0);
  expect({ code: error?.code, proofs }).toEqual({ code: "ERR_POSTGRES_INVALID_MESSAGE", proofs: 0 });
});

// The advertised count is baked into the role's stored password, so dialing
// again cannot help: like the other authentication errors, the pool reports
// the stored error to later connect attempts instead of redoing the handshake.
test.concurrent("postgres: the pool does not redial after a too-high iteration count", async () => {
  const user = "i10000002";
  const db = new SQL({
    url: `postgres://${user}:${PASSWORD}@127.0.0.1:${port}/db?sslmode=disable`,
    max: 1,
    connectionTimeout: 30,
  });
  try {
    const codes: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      codes.push(
        await db.connect().then(
          () => "connected",
          (e: any) => e.code,
        ),
      );
    }
    expect({ codes, startups: startupsByUser.get(user) }).toEqual({
      codes: ["ERR_POSTGRES_SASL_ITERATION_COUNT_TOO_HIGH", "ERR_POSTGRES_SASL_ITERATION_COUNT_TOO_HIGH"],
      startups: 1,
    });
  } finally {
    await db.close({ timeout: 0 });
  }
});
