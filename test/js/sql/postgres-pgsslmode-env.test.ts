// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as selfSignedTls } from "harness";
import type net from "node:net";
import tls from "node:tls";
import { listeningServer, pgAuthenticationOk, pgReadyForQuery, pgSSLResponse } from "./wire-frames";

// Bun.SQL picks up PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the
// environment but previously ignored PGSSLMODE, so PGSSLMODE=require next to a
// env-driven connection would connect in plaintext. The same ?sslmode=require
// on a URL already enforced TLS, so only the env plumbing was missing.
//
// The server here is the plaintext-only shape from the bug report: it answers
// the SSLRequest with 'N' and then accepts the plaintext startup. With the fix
// the client must refuse (ERR_POSTGRES_TLS_NOT_AVAILABLE) instead of proceeding.

const fixture = /* js */ `
  import { SQL } from "bun";
  const sql = new SQL({ max: 1, connectionTimeout: 5 });
  try {
    await sql.connect();
    console.log("CONNECTED");
  } catch (e) {
    console.log("ERROR:" + (e?.code ?? e?.message ?? String(e)));
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
`;

async function plaintextOnlyServer() {
  // Answers SSLRequest with 'N'; answers a plaintext StartupMessage with
  // AuthenticationOk + ReadyForQuery. Recognises SSLRequest by its magic
  // (length=8, code=80877103) so sslmode=disable clients that send the
  // StartupMessage directly are also accepted.
  const ready = Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]);
  return listeningServer(socket => {
    let buf = Buffer.alloc(0);
    let sawSSLRequest = false;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!sawSSLRequest && buf.length >= 8 && buf.readInt32BE(0) === 8 && buf.readInt32BE(4) === 80877103) {
        sawSSLRequest = true;
        buf = buf.subarray(8);
        socket.write(pgSSLResponse("N"));
      }
      if (buf.length >= 8 && buf.readInt32BE(4) === 196608) {
        socket.write(ready);
        buf = Buffer.alloc(0);
      }
    });
    socket.on("error", () => {});
  });
}

async function selfSignedTlsServer() {
  // A mock and not the postgres_tls container: the tests need what a real server
  // cannot report, which is whether a StartupMessage arrived and over what.
  //
  // Answers SSLRequest with 'S' and upgrades to TLS with the harness certificate:
  // self-signed, so no trust store accepts it, with a SAN for 127.0.0.1. Answers a
  // StartupMessage, over TLS or in plaintext, with AuthenticationOk + ReadyForQuery.
  const ready = Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]);
  const startups: ("tls" | "plaintext")[] = [];
  const acceptStartup = (socket: net.Socket, via: "tls" | "plaintext", buffered = Buffer.alloc(0)) => {
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length >= 8 && buffered.readInt32BE(4) === 196608) {
        startups.push(via);
        socket.write(ready);
        buffered = Buffer.alloc(0);
      }
    };
    socket.on("data", onData);
    onData(Buffer.alloc(0));
  };
  const { server, port } = await listeningServer(rawSocket => {
    rawSocket.on("error", () => {});
    let first = Buffer.alloc(0);
    const onFirstBytes = (chunk: Buffer) => {
      first = Buffer.concat([first, chunk]);
      if (first.length < 8) return;
      rawSocket.removeListener("data", onFirstBytes);
      if (first.readInt32BE(0) !== 8 || first.readInt32BE(4) !== 80877103) {
        // Not an SSLRequest: the client skipped TLS.
        acceptStartup(rawSocket, "plaintext", first);
        return;
      }
      rawSocket.pause();
      // Bytes past the 8-byte SSLRequest are the start of the ClientHello.
      if (first.length > 8) rawSocket.unshift(first.subarray(8));
      rawSocket.write(pgSSLResponse("S"));
      const socket = new tls.TLSSocket(rawSocket, { isServer: true, key: selfSignedTls.key, cert: selfSignedTls.cert });
      socket.on("error", () => {});
      acceptStartup(socket, "tls");
    };
    rawSocket.on("data", onFirstBytes);
  });
  return { server, port, startups };
}

function pgEnv(port: number, extra: Record<string, string> = {}) {
  const env: Record<string, string> = { ...bunEnv };
  for (const key of Object.keys(env)) {
    if (/^(PG|PG_|POSTGRES_|DATABASE_|TLS_|MYSQL|MARIADB|SQLITE)/.test(key)) delete env[key];
  }
  // `0` in the runner's shell turns the certificate check off for a verify-* mode.
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  env.PGHOST = "127.0.0.1";
  env.PGPORT = String(port);
  env.PGUSER = "u";
  env.PGPASSWORD = "pw";
  env.PGDATABASE = "db";
  return { ...env, ...extra };
}

test.concurrent("PGSSLMODE=require from the environment refuses a plaintext-only server", async () => {
  const { server, port } = await plaintextOnlyServer();
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: pgEnv(port, { PGSSLMODE: "require" }),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ERROR:ERR_POSTGRES_TLS_NOT_AVAILABLE");
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("PGSSLMODE=verify-full from the environment refuses a plaintext-only server", async () => {
  const { server, port } = await plaintextOnlyServer();
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: pgEnv(port, { PGSSLMODE: "verify-full" }),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ERROR:ERR_POSTGRES_TLS_NOT_AVAILABLE");
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test.concurrent("URL ?sslmode=disable overrides PGSSLMODE=require", async () => {
  const { server, port } = await plaintextOnlyServer();
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: pgEnv(port, {
        PGSSLMODE: "require",
        POSTGRES_URL: `postgres://u:pw@127.0.0.1:${port}/db?sslmode=disable`,
      }),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("CONNECTED");
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

/** Runs the fixture against a fresh self-signed TLS server, with the connection URL in `urlVariable`. */
async function connectToSelfSignedServer(urlVariable: string, query: string, extra: Record<string, string>) {
  const { server, port, startups } = await selfSignedTlsServer();
  let output: [string, string, number];
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: pgEnv(port, { [urlVariable]: `postgres://u:pw@127.0.0.1:${port}/db${query}`, ...extra }),
      stderr: "pipe",
    });
    output = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  } finally {
    // Resolves once every connection has ended, so `startups` is final.
    await new Promise<void>(r => server.close(() => r()));
  }
  const [stdout, stderr, exitCode] = output;
  return { stdout: stdout.trim(), stderr, exitCode, startups };
}

// A URL from a TLS_* variable asks for at least `require`, which does not check
// the server certificate. PGSSLMODE=verify-ca / verify-full next to it must
// still check it: the client then stops inside the TLS handshake, before it
// sends the startup packet. A ?sslmode= in the URL overrides both.
test.concurrent.each([
  [
    "a URL from TLS_DATABASE_URL alone connects without checking the certificate",
    ["TLS_DATABASE_URL", "", {}],
    { stdout: "CONNECTED", startups: ["tls"] },
  ],
  [
    "PGSSLMODE=verify-full next to a URL from TLS_DATABASE_URL checks the certificate",
    ["TLS_DATABASE_URL", "", { PGSSLMODE: "verify-full" }],
    { stdout: "ERROR:DEPTH_ZERO_SELF_SIGNED_CERT", startups: [] },
  ],
  [
    "PGSSLMODE=verify-ca next to a URL from TLS_POSTGRES_DATABASE_URL checks the certificate",
    ["TLS_POSTGRES_DATABASE_URL", "", { PGSSLMODE: "verify-ca" }],
    { stdout: "ERROR:DEPTH_ZERO_SELF_SIGNED_CERT", startups: [] },
  ],
  [
    "?sslmode=disable in a URL from TLS_DATABASE_URL overrides PGSSLMODE=verify-full",
    ["TLS_DATABASE_URL", "?sslmode=disable", { PGSSLMODE: "verify-full" }],
    { stdout: "CONNECTED", startups: ["plaintext"] },
  ],
] as const)("%s", async (_, [urlVariable, query, extra], expected) => {
  expect(await connectToSelfSignedServer(urlVariable, query, extra)).toEqual({
    ...expected,
    stderr: "",
    exitCode: 0,
  });
});
