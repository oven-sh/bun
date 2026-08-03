// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
    console.log("CONNECTED_PLAINTEXT");
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
    expect(stdout.trim()).toBe("CONNECTED_PLAINTEXT");
    expect(exitCode).toBe(0);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
