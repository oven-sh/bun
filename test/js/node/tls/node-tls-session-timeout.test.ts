// `sessionTimeout` is the server's session-lifetime policy: the number of
// seconds a ticket it mints stays resumable. A server must stamp it into every
// session it creates and refuse one that comes back after the window closed.
import { expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
import { once } from "node:events";
import https from "node:https";
import type { AddressInfo } from "node:net";
import tls, { connect, createServer } from "node:tls";

// The session clock has whole-second granularity, so a one-second lifetime is
// only guaranteed expired once two full seconds of wall clock have elapsed.
const SESSION_TIMEOUT_SECONDS = 1;
const PAST_THE_TIMEOUT_MS = SESSION_TIMEOUT_SECONDS * 2000 + 250;
const GET = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";

// `sessionTimeout` is exempt from validation when null, so tests pass it.
type Options = tls.TlsOptions & { sessionTimeout?: number | null };

async function startServer(label: string, options: Options, resumesAfterTheWait: boolean) {
  const reusedServerSide: boolean[] = [];
  const server = createServer({ ...COMMON_CERT, ...options }, socket => {
    reusedServerSide.push(socket.isSessionReused());
    socket.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { label, server, reusedServerSide, resumesAfterTheWait, port: (server.address() as AddressInfo).port };
}

// Resolves on close, which is after the NewSessionTicket a TLSv1.3 server only
// sends post-handshake. `ticket` stays undefined when the server resumes
// without minting a replacement; `request` drives servers that close on reply.
function handshake(port: number, session?: Buffer, request?: string) {
  const { promise, resolve, reject } = Promise.withResolvers<{ reused: boolean; ticket?: Buffer }>();
  let reused = false;
  let ticket: Buffer | undefined;
  const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, session }, () => {
    reused = socket.isSessionReused();
    if (request) socket.write(request);
  });
  socket.on("session", received => (ticket = received));
  socket.on("data", () => {});
  socket.on("error", reject);
  socket.on("close", () => resolve({ reused, ticket }));
  return promise;
}

test("tls.createServer refuses a ticket handed back after sessionTimeout has passed", async () => {
  const servers = await Promise.all(
    (["TLSv1.2", "TLSv1.3"] as const).flatMap(maxVersion => [
      startServer(`${maxVersion} sessionTimeout=1`, { maxVersion, sessionTimeout: SESSION_TIMEOUT_SECONDS }, false),
      // 0, null and "omitted" all mean the TLS library's own (hours-long)
      // default. Same cert, key and version as the one-second server above, so
      // these also pin that the SSL_CTX cache keys on sessionTimeout.
      startServer(`${maxVersion} sessionTimeout=0`, { maxVersion, sessionTimeout: 0 }, true),
      startServer(`${maxVersion} sessionTimeout=null`, { maxVersion, sessionTimeout: null }, true),
      startServer(`${maxVersion} no sessionTimeout`, { maxVersion }, true),
    ]),
  );
  try {
    const fresh = await Promise.all(servers.map(({ port }) => handshake(port)));
    expect(fresh.map(({ reused, ticket }) => ({ reused, gotTicket: ticket !== undefined }))).toEqual(
      servers.map(() => ({ reused: false, gotTicket: true })),
    );

    await Bun.sleep(PAST_THE_TIMEOUT_MS);

    const again = await Promise.all(servers.map(({ port }, i) => handshake(port, fresh[i].ticket)));

    expect(
      servers.map(({ label, reusedServerSide }, i) => ({
        label,
        client: again[i].reused,
        server: reusedServerSide[1],
      })),
    ).toEqual(
      servers.map(({ label, resumesAfterTheWait }) => ({
        label,
        client: resumesAfterTheWait,
        server: resumesAfterTheWait,
      })),
    );
  } finally {
    for (const { server } of servers) server.close();
  }
  await Promise.all(servers.map(({ server }) => once(server, "close")));
});

test("https.createServer stamps sessionTimeout into its tickets too", async () => {
  const server = https.createServer({ ...COMMON_CERT, sessionTimeout: SESSION_TIMEOUT_SECONDS }, (_, res) => res.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as AddressInfo).port;
    const fresh = await handshake(port, undefined, GET);
    expect({ reused: fresh.reused, gotTicket: fresh.ticket !== undefined }).toEqual({ reused: false, gotTicket: true });

    await Bun.sleep(PAST_THE_TIMEOUT_MS);

    expect((await handshake(port, fresh.ticket, GET)).reused).toBe(false);
  } finally {
    server.close();
  }
  await once(server, "close");
});

// A null sessionTimeout is exempt from validation (Node's check is the same) and
// has to reach the native option parser as `undefined`, which is the only value
// that parser reads as absent. The server cases above already cover
// tls.createServer; these are the other two paths that forward the option.
test("sessionTimeout: null is accepted as 'not provided'", async () => {
  expect(tls.createSecureContext({ sessionTimeout: null } as Options)).toBeDefined();

  const server = https.createServer({ ...COMMON_CERT, sessionTimeout: null } as Options, (_, res) => res.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { reused } = await handshake((server.address() as AddressInfo).port, undefined, GET);
    expect(reused).toBe(false);
  } finally {
    server.close();
  }
  await once(server, "close");
});

// Node's https.Server extends tls.Server, so both entry points reject the same
// values, synchronously at construction. Bun's https.Server is http.Server, which
// builds its TLS options bag by hand, so it has to run the same check.
test.each([
  [-1, "ERR_OUT_OF_RANGE"],
  [2 ** 31, "ERR_OUT_OF_RANGE"],
  [1.5, "ERR_OUT_OF_RANGE"],
  ["300", "ERR_INVALID_ARG_TYPE"],
] as const)("tls.createServer and https.createServer both reject sessionTimeout %p", (sessionTimeout, code) => {
  const options = { ...COMMON_CERT, sessionTimeout } as unknown as Options;
  expect(() => createServer(options)).toThrow(expect.objectContaining({ code }));
  expect(() => https.createServer(options)).toThrow(expect.objectContaining({ code }));
});
