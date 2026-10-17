// Password authentication against servers that ask for one. `postgres_plain` trusts everybody, so a login there proves
// nothing. The roles and the method each one is asked for:
//   postgres_auth  test/docker/init-scripts/postgres-auth/01-init.sql, test/docker/config/pg_hba_auth.conf
//   postgres_tls   test/js/sql/docker-tls/Dockerfile

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, tls as harnessTls, isWindows, tempDir } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import nodeTls from "node:tls";
import {
  listeningServer,
  pgAuthenticationCleartextPassword,
  pgAuthenticationMD5Password,
  pgAuthenticationOk,
  pgAuthenticationSASL,
  pgScramServer,
  pgSSLRequest,
  pgSSLResponse,
} from "./wire-frames";

type Password = SQL.PostgresOrMySQLOptions["password"];

const rejection = (query: Promise<unknown>) =>
  query.then(
    rows => ({ resolved: rows }),
    error => error,
  );
const refused = (username: string) => ({
  name: "PostgresError",
  code: "ERR_POSTGRES_SERVER_ERROR",
  errno: "28P01",
  severity: "FATAL",
  message: `password authentication failed for user "${username}"`,
});

const md5 = ["md5", "bun_sql_test_md5", "bun_sql_test_md5"] as const;
const scram = ["scram-sha-256", "bun_sql_test_scram", "bun_sql_test_scram"] as const;

const services = [
  {
    image: "postgres_auth",
    tls: undefined,
    logins: [
      md5,
      scram,
      ["cleartext password", "bun_sql_test_password", "bun_sql_test_password"],
      [
        "scram-sha-256 with a password longer than 64 bytes",
        "bun_sql_test_long",
        "bun_sql_test_long_".padEnd(100, "0123456789"),
      ],
    ],
    verifiers: [
      { rolname: "bun_sql_test_long", verifier: "SCRAM-SHA-256$4096" },
      { rolname: "bun_sql_test_md5", verifier: "md5" },
      { rolname: "bun_sql_test_password", verifier: "SCRAM-SHA-256$4096" },
      { rolname: "bun_sql_test_saslprep", verifier: "SCRAM-SHA-256$4096" },
      { rolname: "bun_sql_test_scram", verifier: "SCRAM-SHA-256$4096" },
      { rolname: "bun_sql_test_scram_1000", verifier: "SCRAM-SHA-256$1000" },
    ],
  },
  {
    image: "postgres_tls",
    tls: { ca: Bun.file(path.join(import.meta.dir, "docker-tls", "server.crt")), serverName: "localhost" },
    logins: [md5, scram],
    verifiers: [
      { rolname: "bun_sql_test_md5", verifier: "md5" },
      { rolname: "bun_sql_test_scram", verifier: "SCRAM-SHA-256$4096" },
    ],
  },
] as const;

for (const { image, tls, logins, verifiers } of services) {
  describeWithContainer(image, { image, concurrent: true }, container => {
    const connect = (username: string, password?: Password) =>
      new SQL({
        adapter: "postgres",
        hostname: container.host,
        port: container.port,
        database: "bun_sql_test",
        username,
        password,
        tls,
        max: 1,
      });

    // An md5 verifier cannot answer SCRAM, and a SCRAM verifier under an `md5` rule is asked for SCRAM: the tests below
    // exercise the method in their name only while this holds.
    test("every role has the kind of verifier its method needs", async () => {
      await container.ready;
      await using sql = connect("postgres");
      expect(
        await sql`
          select rolname, substring(rolpassword from '^(md5|SCRAM-SHA-256\\$[0-9]+)') as verifier
          from pg_authid where rolname like 'bun_sql_test_%' order by rolname`,
      ).toEqual([...verifiers]);
    });

    test.each(logins)("%s: logs in", async (_, username, password) => {
      await container.ready;
      await using sql = connect(username, password);
      expect(await sql`select current_user as x`).toEqual([{ x: username }]);
    });

    test.each(logins)("%s: logs in with the password in the URL", async (_, username, password) => {
      await container.ready;
      const url = `postgres://${username}:${password}@${container.host}:${container.port}/bun_sql_test`;
      await using sql = new SQL(url, { tls, max: 1 });
      expect(await sql`select current_user as x`).toEqual([{ x: username }]);
    });

    test.each(logins)("%s: a wrong password is refused", async (_, username, password) => {
      await container.ready;
      await using sql = connect(username, password + "x");
      expect(await rejection(sql`select 1 as x`)).toMatchObject(refused(username));
    });

    // The other methods send the password as it is. The function is asked once for each login.
    test.each(logins)(
      "%s: a wrong password that SASLprep changes costs a second login with SCRAM only",
      async (method, username, password) => {
        await container.ready;
        for (const logIn of [
          (sql: SQL) => sql`select 1 as x`,
          (sql: SQL) => sql.listen("bun_sql_test_wrong_password", () => {}),
        ]) {
          let asked = 0;
          await using sql = connect(username, () => (asked++, password + "\u00aa"));
          expect([await rejection(logIn(sql)), asked]).toMatchObject([
            refused(username),
            method.startsWith("scram") ? 2 : 1,
          ]);
        }
      },
    );

    test.each(logins)("%s: no password is refused", async (method, username) => {
      await container.ready;
      await using sql = connect(username);
      expect(await rejection(sql`select 1 as x`)).toMatchObject({
        ...refused(username),
        ...(method === "cleartext password" && { message: "empty password returned by client" }),
      });
    });
  });
}

describeWithContainer("postgres_auth: scram-sha-256", { image: "postgres_auth", concurrent: true }, container => {
  const connect = (username: string, password: Password, max = 1) =>
    new SQL({
      adapter: "postgres",
      hostname: container.host,
      port: container.port,
      database: "bun_sql_test",
      username,
      password,
      max,
    });

  test("every connection of a pool logs in", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram", "bun_sql_test_scram", 3);
    const reserved = await Promise.all([sql.reserve(), sql.reserve(), sql.reserve()]);
    try {
      const rows = await Promise.all(reserved.map(connection => connection`select pg_backend_pid() as pid`));
      expect(new Set(rows.map(([{ pid }]) => pid)).size).toBe(3);
    } finally {
      for (const connection of reserved) connection.release();
    }
  });

  test("the server stores SASLprep(password)", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_saslprep", "softhyphen");
    expect(await sql`select current_user as x`).toEqual([{ x: "bun_sql_test_saslprep" }]);
  });

  test("scram-sha-256: SASLprep is applied to the password", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_saslprep", "soft\u00adhyphen");
    expect(await sql`select current_user as x`).toEqual([{ x: "bun_sql_test_saslprep" }]);
  });

  test("scram-sha-256: SASLprep is applied to the password when listen() is the first to log in", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_saslprep", "soft\u00adhyphen");
    await using subscription = await sql.listen("bun_sql_test_saslprep", () => {});
    expect(subscription.channel).toBe("bun_sql_test_saslprep");
  });

  test("scram-sha-256: an iteration count below 4096 is refused by name", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram_1000", "bun_sql_test_scram_1000");
    expect(await rejection(sql`select 1 as x`)).toMatchObject({
      name: "PostgresError",
      code: "ERR_POSTGRES_SASL_ITERATION_COUNT_OUT_OF_RANGE",
      message: "SCRAM-SHA-256 iteration count 1000 is out of range: it must be between 4096 and 10000000",
    });
  });

  test.each([
    ["a function", () => "bun_sql_test_scram"],
    ["a function that returns a resolved promise", () => Promise.resolve("bun_sql_test_scram")],
    [
      "an async function that settles later",
      async () => {
        await Bun.sleep(1);
        return "bun_sql_test_scram";
      },
    ],
  ])("password: %s", async (_, password) => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram", password);
    expect(await sql`select current_user as x`).toEqual([{ x: "bun_sql_test_scram" }]);
  });

  test("password: what the function returns is what is sent", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram", () => "wrong");
    expect(await rejection(sql`select 1 as x`)).toMatchObject(refused("bun_sql_test_scram"));
  });

  test.each([
    ["a function that returns a rejected promise", () => Promise.reject(new Error("password error"))],
    [
      "an async function that throws later",
      async () => {
        await Bun.sleep(1);
        throw new Error("password error");
      },
    ],
  ])("password: %s rejects the query with that error", async (_, password) => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram", password);
    const error = await rejection(sql`select 1 as x`);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("password error");
  });
});

describeWithContainer("postgres_tls: channel binding", { image: "postgres_tls", concurrent: true }, container => {
  const connect = (
    username: string,
    channelBinding: "disable" | "prefer" | "require",
    password = username,
    through?: Pick<SQL.PostgresOrMySQLOptions, "hostname" | "port" | "tls">,
  ) =>
    new SQL({
      adapter: "postgres",
      hostname: container.host,
      port: container.port,
      database: "bun_sql_test",
      username,
      password,
      channelBinding,
      tls: services[1].tls,
      max: 1,
      ...through,
    });

  // `require` only accepts a login that SCRAM-SHA-256-PLUS finished: the server checked the hash of its own certificate.
  test.each(["require", "prefer", "disable"] as const)("%s logs in", async channelBinding => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram", channelBinding);
    expect(await sql`select current_user as x`).toEqual([{ x: "bun_sql_test_scram" }]);
  });

  test("require: a wrong password is refused", async () => {
    await container.ready;
    await using sql = connect("bun_sql_test_scram", "require", "wrong");
    expect(await rejection(sql`select 1 as x`)).toMatchObject(refused("bun_sql_test_scram"));
  });

  /** Ends the client's TLS with a certificate of its own and relays to the server over a second TLS connection. */
  const tlsTerminatingProxy = (hidePlus: boolean) =>
    listeningServer(raw => {
      raw.once("data", () => {
        const upstream = net.connect(container.port, container.host, () => upstream.write(pgSSLRequest()));
        upstream.once("data", () => {
          raw.write(pgSSLResponse("S"));
          const client = new nodeTls.TLSSocket(raw, { isServer: true, key: harnessTls.key, cert: harnessTls.cert });
          const server = nodeTls.connect({ socket: upstream, rejectUnauthorized: false });
          const isAuthenticationSASL = (chunk: Buffer) => chunk[0] === 0x52 /* 'R' */ && chunk.readInt32BE(5) === 10;
          client.on("data", chunk => server.write(chunk));
          server.on("data", chunk =>
            client.write(hidePlus && isAuthenticationSASL(chunk) ? pgAuthenticationSASL(["SCRAM-SHA-256"]) : chunk),
          );
          server.on("end", () => client.end());
          client.on("close", () => server.destroy());
          for (const socket of [raw, upstream, client, server]) socket.on("error", () => {});
        });
      });
    });

  // A client that does not verify the certificate lets the proxy in. What it proves about the password is bound to the
  // certificate it saw, so the server, which has another one, does not take it from the proxy.
  test.each([
    ["prefer", "relays the list of mechanisms", false, "SCRAM channel binding check failed"],
    ["prefer", "takes -PLUS off the list", true, "SCRAM channel binding negotiation error"],
    ["require", "relays the list of mechanisms", false, "SCRAM channel binding check failed"],
    // That the proxy works, and that the binding is what stops it.
    ["disable", "relays the list of mechanisms", false, null],
  ] as const)("%s: a proxy that terminates TLS and %s", async (channelBinding, _, hidePlus, refusal) => {
    await container.ready;
    const { port, server } = await tlsTerminatingProxy(hidePlus);
    try {
      await using sql = connect("bun_sql_test_scram", channelBinding, undefined, {
        hostname: "127.0.0.1",
        port,
        tls: { rejectUnauthorized: false },
      });
      const outcome = await sql`select current_user as x`.then(
        ([{ x }]) => `logged in as ${x}`,
        ({ errno, message }) => `${errno} ${message}`,
      );
      expect(outcome).toBe(refusal ? `28000 ${refusal}` : "logged in as bun_sql_test_scram");
    } finally {
      server.close();
    }
  });
});

// What no real server can be made to do: offer a list that does not fit the socket, and show what the client sent.
describe.concurrent("scripted server", () => {
  const PLAIN = "SCRAM-SHA-256";
  const PLUS = "SCRAM-SHA-256-PLUS";
  const fixture = (name: string) =>
    fs.readFileSync(path.join(import.meta.dir, "..", "node", "tls", "fixtures", name), "utf8");
  // The key of ec10 under certificates whose signature algorithm does not name SHA-256. `digest`: what libpq 15 hashes
  // the certificate with (RFC 5929 §4.1).
  //   openssl req -x509 -key ec10-key.pem -sha384 -days 36500 -subj /CN=localhost
  //   openssl x509 -req -in ec10.csr -CA ca.crt -CAkey rsa.key -sha384 -sigopt rsa_padding_mode:pss -sigopt rsa_pss_saltlen:48
  const ec10 = (digest: string, base64: string) => ({
    key: fixture("ec10-key.pem"),
    cert: `-----BEGIN CERTIFICATE-----\n${base64.trim().replace(/\s+/g, "\n")}\n-----END CERTIFICATE-----\n`,
    digest,
  });
  const certificates = {
    rsa: { key: harnessTls.key, cert: harnessTls.cert },
    ecdsa: { key: fixture("ec10-key.pem"), cert: fixture("ec10-cert.pem") },
    ed25519: { key: fixture("ed25519-key.pem"), cert: fixture("ed25519-cert.pem") },
    ecdsaSha384: ec10(
      "sha384",
      `MIIBfzCCASWgAwIBAgIUfXlJOj2HePDSP2/HoUmPaQimEHgwCgYIKoZIzj0EAwMw
       FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAxNTAxMzkzNFoYDzIxMjYwOTIx
       MDEzOTM0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
       PQMBBwNCAAQ7lrEDVSfMD2Y6hapJFXrmH2K34LLXDzuwInBq4H0Cnhb8/qC3evlP
       jhhTBYdPi5COqEwA7Hq1jBcrmoqgyBcwo1MwUTAdBgNVHQ4EFgQUJiRLe3sYxX0S
       TQ77/Wi2Yq0mkFIwHwYDVR0jBBgwFoAUJiRLe3sYxX0STQ77/Wi2Yq0mkFIwDwYD
       VR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAwNIADBFAiBktlrffoczIvqaIGguJERM
       9ckawFStH5q9HdyyIF34EAIhANhr7Ex3p7F7axSUhTJQT2NLB3XvYYzo+xCb59Dp
       y0k5`,
    ),
    ecdsaSha1: ec10(
      "sha256",
      `MIIBfjCCASSgAwIBAgIUM3G6hB5mlKxjin2e8Xes5Ry3LHUwCQYHKoZIzj0EATAU
       MRIwEAYDVQQDDAlsb2NhbGhvc3QwIBcNMjYxMDE1MDEzOTM0WhgPMjEyNjA5MjEw
       MTM5MzRaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49
       AwEHA0IABDuWsQNVJ8wPZjqFqkkVeuYfYrfgstcPO7AicGrgfQKeFvz+oLd6+U+O
       GFMFh0+LkI6oTADserWMFyuaiqDIFzCjUzBRMB0GA1UdDgQWBBQmJEt7exjFfRJN
       Dvv9aLZirSaQUjAfBgNVHSMEGDAWgBQmJEt7exjFfRJNDvv9aLZirSaQUjAPBgNV
       HRMBAf8EBTADAQH/MAkGByqGSM49BAEDSQAwRgIhANX9WW432uDdbJixctQJjUNp
       Z5bGZ2WGofIXpGEc9gNTAiEAn8ElzLpQ9bB+aDBupTxdK9viCWwGwC8vJ3dCttO1
       AHQ=`,
    ),
    pssSha384: ec10(
      "sha384",
      `MIIB/DCCATGgAwIBAgIBATBBBgkqhkiG9w0BAQowNKAPMA0GCWCGSAFlAwQCAgUA
       oRwwGgYJKoZIhvcNAQEIMA0GCWCGSAFlAwQCAgUAogMCATAwDTELMAkGA1UEAwwC
       Y2EwIBcNMjYxMDE1MDEzOTM0WhgPMjEyNjA5MjEwMTM5MzRaMBQxEjAQBgNVBAMM
       CWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABDuWsQNVJ8wPZjqF
       qkkVeuYfYrfgstcPO7AicGrgfQKeFvz+oLd6+U+OGFMFh0+LkI6oTADserWMFyua
       iqDIFzCjQjBAMB0GA1UdDgQWBBQmJEt7exjFfRJNDvv9aLZirSaQUjAfBgNVHSME
       GDAWgBTZqCtCyMx71v7YDfLZEpDPP5sBDjBBBgkqhkiG9w0BAQowNKAPMA0GCWCG
       SAFlAwQCAgUAoRwwGgYJKoZIhvcNAQEIMA0GCWCGSAFlAwQCAgUAogMCATADgYEA
       OpLvNwFcpG0Dx43JZleIWsJ+wLn2AmgPzkGnzPFsTmyi+/y+hF7ZM5oS+If9ZsT3
       r5CZUmDmRRWCN53jsdgwR1rMyegU6oqkyELdp7JxdUPftTZVSKgP7QTotq7c3w62
       20hVqm+4/IbAteasxA/wPLP23b3IgGtf8b8CMIAfLuM=`,
    ),
    // No parameters: every one has its default, and the default digest is SHA-1.
    pssDefault: ec10(
      "sha256",
      `MIIBkzCB/aADAgECAgECMA0GCSqGSIb3DQEBCjAAMA0xCzAJBgNVBAMMAmNhMCAX
       DTI2MTAxNTAxMzkzNFoYDzIxMjYwOTIxMDEzOTM0WjAUMRIwEAYDVQQDDAlsb2Nh
       bGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQ7lrEDVSfMD2Y6hapJFXrm
       H2K34LLXDzuwInBq4H0Cnhb8/qC3evlPjhhTBYdPi5COqEwA7Hq1jBcrmoqgyBcw
       o0IwQDAdBgNVHQ4EFgQUJiRLe3sYxX0STQ77/Wi2Yq0mkFIwHwYDVR0jBBgwFoAU
       2agrQsjMe9b+2A3y2RKQzz+bAQ4wDQYJKoZIhvcNAQEKMAADgYEAPY2orBpnndH3
       clYV6LtfSx/ep1YSRRjqdORr3to5ZFxLrBiU97gfTRKYo1BEJHs318OQ7HFhQZZu
       rOZ81j6LHFvFasYeVzcchMnWvo5FOAcUdFRp2ZoejUJ6JfSdl3YkM/TNw3Iy5bWc
       xA11BfMbDLf2SpJIFvvRVxj5k/zWgcE=`,
    ),
  };
  type Server = Parameters<typeof pgScramServer>[0] & { clientTls: SQL.PostgresOrMySQLOptions["tls"] };

  async function login(
    { clientTls, ...server }: Partial<Server>,
    channelBinding?: "disable" | "prefer" | "require",
    password = "secret",
    exchanges = 1,
  ) {
    await using mock = await pgScramServer({ password: "secret", ...server });
    await using sql = new SQL({
      adapter: "postgres",
      hostname: "127.0.0.1",
      port: mock.port,
      username: "u",
      database: "db",
      password,
      channelBinding,
      // The chain is not what these tests are about.
      tls: clientTls ?? (server.tls ? { rejectUnauthorized: false } : false),
      max: 1,
    });
    const result = await sql.connect().then(
      () => "connected",
      ({ name, code, message }) => ({ name, code, message }),
    );
    expect(mock.exchanges).toHaveLength(exchanges);
    const { initial, clientFinal, proofOk } = mock.exchanges[exchanges - 1];
    return {
      result,
      mechanism: initial?.mechanism,
      gs2: initial?.clientFirstMessage.replace(/n=.*$/, ""),
      sentProof: clientFinal !== null,
      proofOk,
    };
  }
  const nothingSent = { mechanism: undefined, gs2: undefined, sentProof: false, proofOk: null };

  test.each([
    [
      "TLS, -PLUS offered, by default: does not bind",
      { tls: certificates.rsa, mechanisms: [PLUS, PLAIN] },
      undefined,
      PLAIN,
      "n,,",
    ],
    [
      "TLS, -PLUS offered: binds",
      { tls: certificates.rsa, mechanisms: [PLUS, PLAIN] },
      "prefer",
      PLUS,
      "p=tls-server-end-point,,",
    ],
    [
      "TLS, an ECDSA certificate: binds",
      { tls: certificates.ecdsa, mechanisms: [PLUS, PLAIN] },
      "require",
      PLUS,
      "p=tls-server-end-point,,",
    ],
    [
      "TLS, only -PLUS offered: binds",
      { tls: certificates.rsa, mechanisms: [PLUS] },
      "prefer",
      PLUS,
      "p=tls-server-end-point,,",
    ],
    // A server that does know -PLUS refuses `y`: somebody took it off the list.
    [
      "TLS, -PLUS not offered: says that it could have",
      { tls: certificates.rsa, mechanisms: [PLAIN] },
      "prefer",
      PLAIN,
      "y,,",
    ],
    ["TLS, disable: does not bind", { tls: certificates.rsa, mechanisms: [PLUS, PLAIN] }, "disable", PLAIN, "n,,"],
    [
      "TLS, disable, a certificate that cannot be hashed",
      { tls: certificates.ed25519, mechanisms: [PLUS, PLAIN] },
      "disable",
      PLAIN,
      "n,,",
    ],
    ["no TLS", { mechanisms: [PLAIN] }, "prefer", PLAIN, "n,,"],
    // A proxy that speaks TLS to the server for a client that was told to speak plaintext.
    ["no TLS, -PLUS offered", { mechanisms: [PLUS, PLAIN] }, "prefer", PLAIN, "n,,"],
    ["no TLS, -PLUS offered, disable", { mechanisms: [PLUS, PLAIN] }, "disable", PLAIN, "n,,"],
    [
      "sslmode=prefer and a server that declines TLS, -PLUS offered, disable",
      { mechanisms: [PLUS, PLAIN], clientTls: "prefer" },
      "disable",
      PLAIN,
      "n,,",
    ],
  ] as const)("%s", async (_, server, channelBinding, mechanism, gs2) => {
    expect(await login(server as Partial<Server>, channelBinding)).toEqual({
      result: "connected",
      mechanism,
      gs2,
      sentProof: true,
      proofOk: true,
    });
  });

  // The mock takes the proof only with the hash that `digest` names.
  test.each([
    ["ECDSA with SHA-384", "ecdsaSha384"],
    ["ECDSA with SHA-1", "ecdsaSha1"],
    ["RSASSA-PSS with SHA-384", "pssSha384"],
    ["RSASSA-PSS with its defaults", "pssDefault"],
  ] as const)("TLS, a certificate signed with %s: binds", async (_, certificate) => {
    expect(await login({ tls: certificates[certificate], mechanisms: [PLUS, PLAIN] }, "require")).toMatchObject({
      result: "connected",
      mechanism: PLUS,
      proofOk: true,
    });
  });

  test.each([
    [
      // The client wanted TLS, the server is on TLS, and the client is not.
      "sslmode=prefer and a server that declines TLS, -PLUS offered",
      { mechanisms: [PLUS, PLAIN], clientTls: "prefer" },
      "prefer",
      "ERR_POSTGRES_CHANNEL_BINDING_FAILED",
      'server offered SCRAM-SHA-256-PLUS authentication over a non-SSL connection. channelBinding: "disable" connects without channel binding',
    ],
    [
      "require, no TLS, -PLUS offered",
      { mechanisms: [PLUS, PLAIN] },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding required, but SSL not in use",
    ],
    [
      "require, -PLUS not offered",
      { tls: certificates.rsa, mechanisms: [PLAIN] },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding is required, but server did not offer an authentication method that supports channel binding",
    ],
    [
      "require, no TLS",
      { mechanisms: [PLAIN] },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding required, but SSL not in use",
    ],
    [
      "require, sslmode=prefer and a server that declines TLS",
      { mechanisms: [PLAIN], clientTls: "prefer" },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding required, but SSL not in use",
    ],
    [
      // Who terminates TLS picks the certificate: falling back to `n` would let it switch the binding off.
      "prefer, a certificate that cannot be hashed",
      { tls: certificates.ed25519, mechanisms: [PLUS, PLAIN] },
      "prefer",
      "ERR_POSTGRES_CHANNEL_BINDING_FAILED",
      `could not get the hash of the server's certificate for channel binding: its signature algorithm names no digest. channelBinding: "disable" connects without channel binding`,
    ],
    [
      "disable, only -PLUS offered",
      { tls: certificates.rsa, mechanisms: [PLUS] },
      "disable",
      "ERR_POSTGRES_SASL_NO_KNOWN_MECHANISM",
      "none of the server's SASL authentication mechanisms are supported",
    ],
    [
      "no mechanism it knows",
      { mechanisms: ["OAUTHBEARER"] },
      "prefer",
      "ERR_POSTGRES_SASL_NO_KNOWN_MECHANISM",
      "none of the server's SASL authentication mechanisms are supported",
    ],
    // Had the password gone out, the mock would have answered AuthenticationOk and the message would be the next one.
    [
      "require, a cleartext request",
      { tls: certificates.rsa, first: pgAuthenticationCleartextPassword() },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding required but not supported by server's authentication request",
    ],
    [
      "require, an md5 request",
      { tls: certificates.rsa, first: pgAuthenticationMD5Password(Buffer.from("salt")) },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding required but not supported by server's authentication request",
    ],
    [
      "require, AuthenticationOk at once",
      { tls: certificates.rsa, first: pgAuthenticationOk() },
      "require",
      "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
      "channel binding required, but server authenticated client without channel binding",
    ],
  ] as const)("%s: refused, and nothing is sent", async (_, server, channelBinding, code, message) => {
    expect(await login(server as Partial<Server>, channelBinding)).toEqual({
      result: { name: "PostgresError", code, message },
      ...nothingSent,
    });
  });

  test.skipIf(isWindows)("require, a unix socket: refused, and nothing is sent", async () => {
    using dir = tempDir("postgres-auth", {});
    const socketPath = path.join(String(dir), "s");
    const answer = Promise.withResolvers<number>();
    const server = net.createServer(socket => {
      let bytes = 0;
      socket.on("error", () => {});
      socket.on("close", () => answer.resolve(bytes));
      socket.once("data", () => {
        socket.write(pgAuthenticationSASL([PLAIN]));
        socket.on("data", chunk => {
          bytes += chunk.length;
          socket.end();
        });
      });
    });
    await once(server.listen(socketPath), "listening");
    try {
      await using sql = new SQL({
        adapter: "postgres",
        path: socketPath,
        username: "u",
        database: "db",
        password: "secret",
        channelBinding: "require",
        max: 1,
      });
      const refusal = rejection(sql.connect());
      expect(await answer.promise).toBe(0);
      expect(await refusal).toMatchObject({
        code: "ERR_POSTGRES_CHANNEL_BINDING_REQUIRED",
        message: "channel binding required, but SSL not in use",
      });
    } finally {
      server.close();
    }
  });

  test("a mandatory extension in the server-first-message is refused before the proof", async () => {
    expect(await login({ serverFirstExtra: ",m=ext" })).toMatchObject({
      result: { name: "PostgresError", code: "ERR_POSTGRES_INVALID_MESSAGE" },
      sentProof: false,
    });
  });

  // Left: what the user typed. Right: what PostgreSQL 15 makes the verifier from (checked against the real server).
  // The password as it is comes first, SASLprep(password) when that is refused.
  test.each([
    ["maps a non-ASCII space to a space", "a\u00a0b", "a b"],
    ["maps U+200B to a space, as C.1.2 comes first", "a\u200bb", "a b"],
    ["drops what is commonly mapped to nothing", "I\u00adX\u2060", "IX"],
    ["normalizes with NFKC", "\u00aa\u2168", "aIX"],
    ["composes", "e\u0301", "\u00e9"],
    [
      "an output longer than the input",
      "\ufdfa",
      "\u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645",
    ],
    ["outside the BMP", "\u{1d7d8}\u{1d7d9}", "01"],
    ["right-to-left from end to end", "\u05d0\u05d1", "\u05d0\u05d1"],
    // Refused by SASLprep: the password is used as it is.
    ["prohibited: as it is", "a\u0007\u00aa", "a\u0007\u00aa"],
    ["unassigned in Unicode 3.2: as it is", "\u00aa\u{1f600}", "\u00aa\u{1f600}"],
    ["unassigned in Unicode 3.2, in the BMP: as it is", "\u00aa\u2728", "\u00aa\u2728"],
    ["mixed directions: as it is", "\u05d0a\u00aa", "\u05d0a\u00aa"],
    ["right-to-left that does not end so: as it is", "\u05d01\u00aa", "\u05d01\u00aa"],
    ["maps to nothing: as it is", "\u00ad", "\u00ad"],
    ["ASCII control characters: as it is", "a\u0007b", "a\u0007b"],
    // The server's checks look at the mapped input, not at the NFKC output, which here ends in a non-spacing mark...
    ["right-to-left before NFKC only", "\u05d0\ufb1d", "\u05d0\u05d9\u05b4"],
    // ...and here has nothing unassigned left.
    ["unassigned before NFKC only: as it is", "a\ufe12b\u00ad", "a\ufe12b\u00ad"],
  ])("SASLprep %s", async (_, typed, stored) => {
    expect(await login({ password: stored }, undefined, typed, typed === stored ? 1 : 2)).toMatchObject({
      result: "connected",
      proofOk: true,
    });
  });

  test("a wrong password that SASLprep leaves as it is costs one login", async () => {
    expect(await login({}, undefined, "wrong")).toMatchObject({
      result: { code: "ERR_POSTGRES_SERVER_ERROR", message: 'password authentication failed for user "u"' },
      proofOk: false,
    });
  });

  test("a login that fails for another reason is not tried with the other password", async () => {
    expect(await login({ serverFirstExtra: ",m=ext" }, undefined, "se\u00adcret")).toMatchObject({
      result: { code: "ERR_POSTGRES_INVALID_MESSAGE" },
    });
  });

  const client = (port: number) =>
    ({ adapter: "postgres", hostname: "127.0.0.1", port, username: "u", database: "db", tls: false }) as const;

  test("a wrong password that SASLprep changes costs two, and the caller hears of one refusal", async () => {
    await using mock = await pgScramServer({ password: "secret" });
    const closed: unknown[] = [];
    let asked = 0;
    await using sql = new SQL({
      ...client(mock.port),
      password: () => (asked++, "wr\u00adong"),
      onclose: err => void closed.push((err as any)?.errno),
      max: 1,
    });
    expect(await rejection(sql.connect())).toMatchObject(refused("u"));
    expect({ proofs: mock.exchanges.map(exchange => exchange.proofOk), closed, asked }).toEqual({
      proofs: [false, false],
      closed: ["28P01"],
      asked: 2,
    });
  });

  test("the pool goes on with the one that logged in", async () => {
    await using mock = await pgScramServer({ password: "aIX" });
    await using sql = new SQL({ ...client(mock.port), password: "\u00aa\u2168", max: 1 });
    const first = await sql.reserve();
    await first.close();
    using second = await sql.reserve();
    expect(mock.exchanges.map(exchange => exchange.proofOk)).toEqual([false, true, true]);
  });

  test("a password that is a number logs in", async () => {
    expect(await login({ password: "123456" }, undefined, 123456 as never)).toMatchObject({
      result: "connected",
      proofOk: true,
    });
  });
});
