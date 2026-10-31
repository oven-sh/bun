// tls: true and tls: {} carry no options of their own, so tls.setDefaultCACertificates() has to reach them directly.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as serverCert, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const otherCA = readFileSync(join(import.meta.dir, "../node/tls/fixtures/ca1-cert.pem"), "utf8");

// A Postgres server up to TLS: it answers the SSLRequest and reports whether the client's startup message arrived.
const fixture = /* js */ `
  import tls from "node:tls";
  import { SQL } from "bun";
  const { cert, key, list, option } = JSON.parse(process.env.CASE);
  tls.setDefaultCACertificates(list);
  const started = Promise.withResolvers();
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(raw) {
        if (raw.data) return;
        raw.data = true;
        raw.write("S");
        raw.upgradeTLS({
          isServer: true,
          tls: { cert, key },
          socket: { data: () => started.resolve("STARTED"), close() {}, error() {} },
        });
      },
      close() {},
      error() {},
    },
  });
  const sql = new SQL({
    url: "postgres://user@localhost:" + listener.port + "/db?sslmode=verify-full",
    tls: option,
    max: 1,
  });
  const refused = sql\`select 1\`.then(() => "OK", e => "REFUSED");
  console.log(await Promise.race([started.promise, refused]));
  process.exit(0);
`;

test.concurrent.each([
  ["true trusts the default list", true, [serverCert.cert], "STARTED", false],
  ["{} trusts the default list", {}, [serverCert.cert], "STARTED", false],
  ["true refuses a certificate outside it", true, [otherCA], "REFUSED", false],
  ["true trusts nothing with an empty list", true, [], "REFUSED", false],
  ["true refuses what only the runtime store trusts", true, [otherCA], "REFUSED", true],
  ["{} refuses what only the runtime store trusts", {}, [otherCA], "REFUSED", true],
  ["true with an empty list refuses what the runtime store trusts", true, [], "REFUSED", true],
])("tls: %s", async (_name, option, list, expected, runtimeTrusts) => {
  using dir = tempDir("sql-default-ca", { "run.mjs": fixture, "trusted.pem": serverCert.cert });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.mjs"],
    env: {
      ...bunEnv,
      ...(runtimeTrusts && { SSL_CERT_FILE: join(String(dir), "trusted.pem") }),
      CASE: JSON.stringify({ cert: serverCert.cert, key: serverCert.key, list, option }),
    },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: expected, stderr: "" });
  expect(exitCode).toBe(0);
});
