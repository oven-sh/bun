// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  // Answers SSLRequest with 'S', wraps the socket in TLS with a self-signed
  // certificate, then answers the startup with AuthenticationOk + ReadyForQuery.
  const ready = Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]);
  const key = readFileSync(join(import.meta.dir, "docker-tls", "server.key"));
  const cert = readFileSync(join(import.meta.dir, "docker-tls", "server.crt"));
  return listeningServer(rawSocket => {
    let buf = Buffer.alloc(0);
    const onPlainData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 8) return;
      rawSocket.removeListener("data", onPlainData);
      rawSocket.pause();
      const leftover = buf.subarray(8);
      if (leftover.length) rawSocket.unshift(leftover);
      rawSocket.write(pgSSLResponse("S"));
      const tlsSocket = new tls.TLSSocket(rawSocket, { isServer: true, key, cert });
      tlsSocket.on("data", () => tlsSocket.write(ready));
      tlsSocket.on("error", () => {});
    };
    rawSocket.on("data", onPlainData);
    rawSocket.on("error", () => {});
  });
}

function pgEnv(port: number, extra: Record<string, string> = {}) {
  const env: Record<string, string> = { ...bunEnv };
  for (const key of Object.keys(env)) {
    if (/^(PG|PG_|POSTGRES_|DATABASE_|TLS_|MYSQL|MARIADB|SQLITE)/.test(key)) delete env[key];
  }
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

// A verify-ca / verify-full sslmode is an explicit request to verify the
// server certificate. NODE_TLS_REJECT_UNAUTHORIZED=0 may relax a default, but
// it must not silently turn that request off.
test.concurrent.each(["url", "PGSSLMODE"] as const)(
  "sslmode=verify-full from the %s still verifies under NODE_TLS_REJECT_UNAUTHORIZED=0",
  async source => {
    const { server, port } = await selfSignedTlsServer();
    try {
      const extra: Record<string, string> = { NODE_TLS_REJECT_UNAUTHORIZED: "0" };
      if (source === "url") extra.POSTGRES_URL = `postgres://u:pw@localhost:${port}/db?sslmode=verify-full`;
      else extra.PGSSLMODE = "verify-full";
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: pgEnv(port, extra),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("ERROR:DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(exitCode).toBe(0);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  },
);

test.concurrent("sslmode=require does not verify the certificate (the environment default applies)", async () => {
  const { server, port } = await selfSignedTlsServer();
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: pgEnv(port, { PGSSLMODE: "require" }),
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
