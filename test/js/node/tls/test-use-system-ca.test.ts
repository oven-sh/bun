import { listen, serve, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tls as localhost, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { X509Certificate } from "node:crypto";
import { closeSync, constants, existsSync, openSync, readFileSync, symlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";

describe("--use-system-ca", () => {
  test("flag loads system certificates", async () => {
    // Test that --use-system-ca loads system certificates
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=1 loads system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA environment variable works
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("NODE_USE_SYSTEM_CA=0 doesn't load system certificates", async () => {
    // Test that NODE_USE_SYSTEM_CA=0 doesn't load system certificates
    await using proc = spawn({
      cmd: [bunExe(), "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });

  test("--use-system-ca overrides NODE_USE_SYSTEM_CA=0", async () => {
    // Test that CLI flag takes precedence over environment variable
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", "console.log('OK')"],
      env: { ...bunEnv, NODE_USE_SYSTEM_CA: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("OK");
    expect(stderr).toBe("");
  });
});

// On Linux the loader reads a superset of what Node's --use-system-ca reads ($SSL_CERT_FILE else /etc/ssl/cert.pem, and
// every regular file in $SSL_CERT_DIR else /etc/ssl/certs) plus the well-known distro bundle/dir paths, and reports
// each certificate once however many of those alias it.
describe.skipIf(!isLinux)("tls.getCACertificates('system')", () => {
  const fixtureCert = (name: string) =>
    readFileSync(join(import.meta.dir, "../test/fixtures/keys", `${name}-cert.pem`), "utf8");
  const fingerprint = (pem: string) => new X509Certificate(pem).fingerprint256;

  async function systemFingerprints(env: Record<string, string | undefined>, stdin?: Blob): Promise<string[]> {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { X509Certificate } = require("crypto");
         const certs = require("tls").getCACertificates("system");
         console.log(JSON.stringify(certs.map(pem => new X509Certificate(pem).fingerprint256)));`,
      ],
      env: { ...bunEnv, SSL_CERT_FILE: undefined, SSL_CERT_DIR: undefined, ...env },
      stdin,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const fingerprints = JSON.parse(stdout);
    expect(exitCode).toBe(0);
    return fingerprints;
  }

  test("reports each system root once", async () => {
    const hasDefaultStore = existsSync("/etc/ssl/cert.pem") || existsSync("/etc/ssl/certs");
    const fingerprints = await systemFingerprints({});
    if (hasDefaultStore) expect(fingerprints.length).toBeGreaterThan(0);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  test("reads SSL_CERT_FILE and every regular file in SSL_CERT_DIR, each certificate once", async () => {
    const [ca1, ca2, ca3, ca4, ca5, ca6, leaf1, leaf2, leaf3] = [
      "ca1",
      "ca2",
      "ca3",
      "ca4",
      "ca5",
      "ca6",
      "agent1",
      "agent2",
      "agent3",
    ].map(fixtureCert);
    // An encrypted key block carries header lines. PEM_read_bio_X509 decodes it, then skips it by name.
    const encryptedKey =
      "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00112233445566778899AABBCCDDEEFF\n\nQUJDREVGR0hJSktMTU5PUA==\n-----END RSA PRIVATE KEY-----\n";
    const badBlock = "-----BEGIN PRIVATE KEY-----\n!!! not base64 !!!\n-----END PRIVATE KEY-----\n";
    using dir = tempDir("system-ca", {
      "bundle.pem": ca1 + ca2,
      certs: {
        "a-again.pem": ca1, // already in the bundle
        "bad-block.pem": badBlock + leaf2, // a block that does not decode ends the file, whatever its name
        "c.pem": ca3,
        "encrypted-key.pem": encryptedKey + leaf3, // a block with another name is skipped, headers and all
        "multi.crt": ca5 + ca6, // every certificate in a file, not only the first
        "noext": ca4, // names are not filtered
        "README": "not a certificate\n",
        sub: { "d.pem": leaf1 }, // subdirectories are not entered
      },
    });
    // A second name for the same file.
    symlinkSync("c.pem", join(String(dir), "certs", "c-alias.pem"));

    const fingerprints = await systemFingerprints({
      SSL_CERT_FILE: join(String(dir), "bundle.pem"),
      SSL_CERT_DIR: join(String(dir), "certs"),
    });
    // The file first, then the directory in name order: a-again.pem (dropped), bad-block.pem (nothing),
    // c-alias.pem, c.pem (same file, skipped), encrypted-key.pem, multi.crt, noext.
    expect(fingerprints).toEqual([ca1, ca2, ca3, leaf3, ca5, ca6, ca4].map(fingerprint));

    // A variable that is set but empty turns that source off.
    expect(await systemFingerprints({ SSL_CERT_FILE: join(String(dir), "bundle.pem"), SSL_CERT_DIR: "" })).toEqual(
      [ca1, ca2].map(fingerprint),
    );
  });

  test("SSL_CERT_FILE can be a pipe", async () => {
    const ca1 = fixtureCert("ca1");
    const fingerprints = await systemFingerprints({ SSL_CERT_FILE: "/dev/stdin", SSL_CERT_DIR: "" }, new Blob([ca1]));
    expect(fingerprints).toEqual([fingerprint(ca1)]);
  });

  test.skipIf(!existsSync("/etc/ssl/certs"))("SSL_CERT_FILE alone keeps the default directory", async () => {
    using dir = tempDir("system-ca-file", { "bundle.pem": fixtureCert("ca1") });
    const bundle = join(String(dir), "bundle.pem");
    const withDefaultDir = await systemFingerprints({ SSL_CERT_FILE: bundle });
    const withExplicitDir = await systemFingerprints({ SSL_CERT_FILE: bundle, SSL_CERT_DIR: "/etc/ssl/certs" });
    expect(withDefaultDir[0]).toBe(fingerprint(fixtureCert("ca1")));
    // The default also walks the well-known distro directories, so it is a superset (in order) of the explicit one.
    let j = 0;
    for (const fp of withDefaultDir) if (fp === withExplicitDir[j]) j++;
    expect(j).toBe(withExplicitDir.length);
  });
});

// On Linux the default store and the system store both read $SSL_CERT_FILE, in either order.
describe.concurrent.skipIf(!isLinux)("SSL_CERT_FILE that can be read only once", () => {
  const keys = join(import.meta.dir, "../test/fixtures/keys");
  const ca1 = join(keys, "ca1-cert.pem");
  const expected = { connected: "authorized", listed: [new X509Certificate(readFileSync(ca1)).fingerprint256] };

  // Connects with the default store to a server whose certificate ca1 signed, and lists the system store.
  const script = (first: "connect" | "list") =>
    `const tls = require("tls"), fs = require("fs"), { X509Certificate } = require("crypto");
     const list = () => tls.getCACertificates("system").map(pem => new X509Certificate(pem).fingerprint256);
     const connect = () => new Promise(resolve => {
       const server = tls.createServer({ key: fs.readFileSync(${JSON.stringify(join(keys, "agent1-key.pem"))}), cert: fs.readFileSync(${JSON.stringify(join(keys, "agent1-cert.pem"))}) }, s => s.end());
       server.listen(0, () => {
         const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", checkServerIdentity: () => undefined }, () => {
           resolve("authorized");
           socket.destroy();
           server.close();
         });
         socket.on("error", e => { resolve(e.code); server.close(); });
       });
     });
     let connected, listed;
     if (${first === "list"}) { listed = list(); connected = await connect(); }
     else { connected = await connect(); listed = list(); }
     console.log(JSON.stringify({ connected, listed }));`;

  // The shell pipeline makes stdin a real pipe. A Blob stdin is a memfd, which every open reads from the start.
  test.each(["connect", "list"] as const)("a pipe, %s first", async first => {
    await using proc = spawn({
      cmd: ["sh", "-c", 'cat "$CA" | "$BUN" -e "$SCRIPT"'],
      env: {
        ...bunEnv,
        SSL_CERT_FILE: "/dev/stdin",
        SSL_CERT_DIR: "",
        NODE_USE_SYSTEM_CA: undefined,
        CA: ca1,
        BUN: bunExe(),
        SCRIPT: script(first),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // --use-system-ca puts the system store into the default store, so the first connection builds both.
  test("a FIFO that one writer serves, with --use-system-ca", async () => {
    using dir = tempDir("ssl-cert-file-fifo", {});
    const fifo = join(String(dir), "ca.fifo");
    mkfifo(fifo);
    await using writer = spawn({
      cmd: ["sh", "-c", 'cat "$CA" > "$FIFO"'],
      env: { ...bunEnv, CA: ca1, FIFO: fifo },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await using proc = spawn({
      cmd: [bunExe(), "--use-system-ca", "-e", script("connect")],
      env: { ...bunEnv, SSL_CERT_FILE: fifo, SSL_CERT_DIR: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
    expect(await writer.exited).toBe(0);
  });

  // fetch builds the default store on the HTTP thread; the JS thread must wait for that read, not start a second one.
  test("a FIFO that one writer serves, read from two threads at once", async () => {
    using dir = tempDir("ssl-cert-file-fifo-threads", {});
    const fifo = join(String(dir), "ca.fifo");
    mkfifo(fifo);
    // The server is in this process, because a TLS server with no `ca` builds the default store too.
    await using server = Bun.serve({
      port: 0,
      tls: {
        key: readFileSync(join(keys, "agent1-key.pem"), "utf8"),
        cert: readFileSync(join(keys, "agent1-cert.pem"), "utf8"),
      },
      fetch: () => new Response("ok"),
    });
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const tls = require("tls"), fs = require("fs"), { X509Certificate } = require("crypto");
         const fetched = fetch("https://127.0.0.1:${server.port}/", { tls: { checkServerIdentity: () => undefined } }).then(r => r.text(), e => e.code);
         await new Promise(resolve => process.stdin.once("data", resolve));
         fs.writeSync(1, "listing\\n");
         const listed = tls.getCACertificates("system").map(pem => new X509Certificate(pem).fingerprint256);
         console.log(JSON.stringify({ fetched: await fetched, listed }));`,
      ],
      env: { ...bunEnv, SSL_CERT_FILE: fifo, SSL_CERT_DIR: "", NODE_USE_SYSTEM_CA: undefined },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // A non-blocking open for writing fails with ENXIO until a reader (here the HTTP thread) waits in open(2).
    let fd: number;
    while (true) {
      try {
        fd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
        break;
      } catch (e: any) {
        if (e.code !== "ENXIO" || proc.exitCode !== null) throw e;
        await Bun.sleep(1);
      }
    }
    // The HTTP thread now waits in read(2). Let the JS thread ask, and write only after it says it is about to.
    proc.stdin.write("go\n");
    await proc.stdin.end();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    while (!stdout.includes("listing\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    writeSync(fd, readFileSync(ca1));
    closeSync(fd);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("listing\n" + JSON.stringify({ fetched: "ok", listed: expected.listed }) + "\n");
    expect(exitCode).toBe(0);
  });
});

// The default store also trusts what X509_STORE_set_default_paths would: $SSL_CERT_FILE (else /etc/ssl/cert.pem) and
// the $SSL_CERT_DIR (else /etc/ssl/certs) hash directory. The file is read lazily and deduplicated against the bundled
// roots, so these pin that the same certificates are still trusted.
describe.skipIf(isWindows)("default store and OpenSSL's default paths", () => {
  const keys = join(import.meta.dir, "../test/fixtures/keys");
  const ca1 = readFileSync(join(keys, "ca1-cert.pem"), "utf8");

  async function connectWith(env: Record<string, string | undefined>) {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const tls = require("tls"), fs = require("fs");
         const server = tls.createServer({ key: fs.readFileSync(${JSON.stringify(join(keys, "agent1-key.pem"))}), cert: fs.readFileSync(${JSON.stringify(join(keys, "agent1-cert.pem"))}) }, s => s.end());
         server.listen(0, () => {
           const socket = tls.connect({ port: server.address().port, host: "127.0.0.1", checkServerIdentity: () => undefined }, () => {
             console.log("authorized");
             socket.destroy();
             server.close();
           });
           socket.on("error", e => { console.log(e.code); server.close(); });
         });`,
      ],
      env: { ...bunEnv, SSL_CERT_FILE: "", SSL_CERT_DIR: "", NODE_USE_SYSTEM_CA: undefined, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout.trim();
  }

  test("a private CA is not trusted without them", async () => {
    expect(await connectWith({})).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  // only: the CA alone. mixed: after and before bundled roots, which the loader skips as already trusted.
  // bad: X509_load_cert_crl_file rejects the whole file when any block is bad, so nothing in it is trusted.
  test.each([
    ["only", "authorized"],
    ["mixed", "authorized"],
    ["bad", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
  ] as const)("a CA in $SSL_CERT_FILE (%s.pem) -> %s", async (file, expected) => {
    using dir = tempDir("default-ca-file", {
      "only.pem": ca1,
      "mixed.pem": rootCertificates.slice(0, 3).join("\n") + "\n" + ca1 + rootCertificates[3] + "\n",
      "bad.pem": ca1 + "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n",
    });
    expect(await connectWith({ SSL_CERT_FILE: join(String(dir), `${file}.pem`) })).toBe(expected);
  });

  // `openssl x509 -subject_hash -in ca1-cert.pem` is 468820ba; the hash-dir lookup only opens <hash>.<n> names.
  test.each([
    ["468820ba.0", "authorized"],
    ["ca1.pem", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
  ] as const)("a CA in the $SSL_CERT_DIR hash directory as %s -> %s", async (name, expected) => {
    using dir = tempDir("default-ca-dir", { [name]: ca1 });
    expect(await connectWith({ SSL_CERT_DIR: String(dir) })).toBe(expected);
  });
});

describe.concurrent("--use-openssl-ca", () => {
  const flag = "--use-openssl-ca";
  const ca1 = join(import.meta.dir, "../test/fixtures/keys/ca1-cert.pem");

  async function run(cmd: string[], env: Record<string, string | undefined> = {}, cwd?: string) {
    await using proc = spawn({
      cmd: [bunExe(), ...cmd],
      cwd,
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: undefined,
        NODE_EXTRA_CA_CERTS: undefined,
        SSL_CERT_FILE: "",
        SSL_CERT_DIR: "",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // `openssl x509 -subject_hash` of it is 607986c7.
  const bundledRoot = rootCertificates.find(pem =>
    new X509Certificate(pem).subject.endsWith("DigiCert Global Root G2"),
  );

  // Answers a ClientHello with the ServerHello, Certificate and ServerHelloDone of TLS 1.2, which takes no private key, so
  // the certificate can be a bundled root. The client verifies it next. One that trusts the root then fails on something
  // else: the root is not for 127.0.0.1, and may not be used for the key exchange.
  function serveBundledRoot() {
    const uint = (size: number, value: number) => {
      const bytes = Buffer.alloc(size);
      bytes.writeUIntBE(value, 0, size);
      return bytes;
    };
    const message = (type: number, ...fields: Buffer[]) => {
      const body = Buffer.concat(fields);
      return Buffer.concat([uint(1, type), uint(3, body.length), body]);
    };
    const certificate = new X509Certificate(bundledRoot!).raw;
    const messages = Buffer.concat([
      // version 1.2, random, no session id, TLS_RSA_WITH_AES_128_GCM_SHA256, no compression
      message(2, uint(2, 0x0303), Buffer.alloc(32), uint(1, 0), uint(2, 0x009c), uint(1, 0)),
      message(11, uint(3, certificate.length + 3), uint(3, certificate.length), certificate),
      message(14),
    ]);
    const answer = Buffer.concat([uint(1, 22), uint(2, 0x0303), uint(2, messages.length), messages]);
    return listen<{ received: Buffer; answered: boolean }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { received: Buffer.alloc(0), answered: false };
        },
        data(socket, chunk) {
          const state = socket.data;
          if (state.answered) return;
          state.received = Buffer.concat([state.received, chunk]);
          if (state.received.length < 5 || state.received.length < 5 + state.received.readUInt16BE(3)) return;
          state.answered = true;
          socket.write(answer);
        },
      },
    });
  }
  const untrusted = "DEPTH_ZERO_SELF_SIGNED_CERT";

  const clients = {
    fetch: {
      trusted: "ERR_TLS_CERT_ALTNAME_INVALID",
      connect: (port: number) => `fetch("https://127.0.0.1:${port}")`,
    },
    "tls.connect": {
      trusted: "ERR_SSL_KEY_USAGE_BIT_INCORRECT",
      connect: (port: number) => `new Promise((resolve, reject) => require("node:tls").connect({
        host: "127.0.0.1", port: ${port}, maxVersion: "TLSv1.2", checkServerIdentity() {},
      }).on("error", reject))`,
    },
  };

  test.each([
    ["fetch", [], undefined, true],
    ["fetch", [flag], undefined, false],
    ["fetch", [], "BUN_OPTIONS", false],
    ["fetch", [flag], "SSL_CERT_FILE", true],
    ["fetch", [flag], "SSL_CERT_DIR", true],
    ["fetch", [flag], "NODE_EXTRA_CA_CERTS", true],
    ["tls.connect", [], undefined, true],
    ["tls.connect", [flag], undefined, false],
  ] as const)("%s with %j and %p: a bundled root is trusted: %p", async (client, flags, variable, trusted) => {
    expect(bundledRoot).toBeDefined();
    using dir = tempDir("use-openssl-ca", { "root.pem": bundledRoot!, "hashed/607986c7.0": bundledRoot! });
    using server = serveBundledRoot();
    const values = {
      BUN_OPTIONS: flag,
      SSL_CERT_FILE: join(String(dir), "root.pem"),
      SSL_CERT_DIR: join(String(dir), "hashed"),
      NODE_EXTRA_CA_CERTS: join(String(dir), "root.pem"),
    };
    expect(
      await run(
        [...flags, "-e", `${clients[client].connect(server.port)}.catch(error => console.log(error.code));`],
        variable && { [variable]: values[variable] },
      ),
    ).toEqual({ stdout: (trusted ? clients[client].trusted : untrusted) + "\n", stderr: "", exitCode: 0 });
  });

  async function manifestFails(cmd: string[], name: string, expected: string, extraEnv: Record<string, string> = {}) {
    expect(bundledRoot).toBeDefined();
    using server = serveBundledRoot();
    using dir = tempDir("use-openssl-ca-install", {
      "project/package.json": JSON.stringify({ name: "foo", dependencies: { "no-deps": "1.0.0" } }),
      "project/App.tsx": `export default () => <div />;`,
      "home/.bun-create/local-template/package.json": JSON.stringify({
        name: "local-template",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });
    const home = join(String(dir), "home");
    const env = {
      BUN_CONFIG_HTTP_RETRY_COUNT: "0",
      BUN_CONFIG_REGISTRY: `https://127.0.0.1:${server.port}/`,
      BUN_INSTALL_CACHE_DIR: join(home, "cache"),
      BUN_TMPDIR: home,
      TMPDIR: home,
      TEMP: home,
      TMP: home,
      HOME: home,
      USERPROFILE: home,
      ...extraEnv,
    };
    expect(await run(cmd, env, join(String(dir), "project"))).toEqual({
      stdout: expect.any(String),
      stderr: expect.stringContaining(`error: ${expected} downloading package manifest ${name}`),
      // `bun init` has written the project by then.
      exitCode: cmd[0] === "init" ? 0 : 1,
    });
  }

  // All but `bun install` leave the download to a `bun add` or `bun install` that they spawn.
  test.each([
    [["install"], "no-deps", "ERR_TLS_CERT_ALTNAME_INVALID"],
    [["install", flag], "no-deps", untrusted],
    [[flag, "install"], "no-deps", untrusted],
    [["x", "no-deps"], "no-deps", "ERR_TLS_CERT_ALTNAME_INVALID"],
    [["x", flag, "no-deps"], "no-deps", untrusted],
    [["create", flag, "no-deps"], "create-no-deps", untrusted],
    [["create", "local-template", "destination", flag], "no-deps", untrusted],
    [["init", "-y", flag], "@types/bun", untrusted],
    [["init", "--react", flag, "react-app"], "react", untrusted],
  ])("bun %j: the manifest of %s from a registry with a bundled root fails with %s", manifestFails);

  // A todo on Windows like the tests of `bun create <component>` in create-jsx.test.ts. It exits with the failed
  // install while the bundler's threads are alive, and LeakSanitizer reports what they hold.
  test.todoIf(isWindows)("bun create ./App.tsx passes the flag on to its install", async () => {
    await manifestFails(["create", flag, "./App.tsx"], "react", untrusted, {
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    });
  });

  test.each([
    [["build"], rootCertificates.length],
    [["build", flag], 0],
  ])("a macro of bun %j has %d default certificates", async (cmd, count) => {
    using dir = tempDir("use-openssl-ca-macro", {
      "macro.ts": `import { getCACertificates } from "node:tls";\nexport const count = () => getCACertificates("default").length;`,
      "entry.ts": `import { count } from "./macro.ts" with { type: "macro" };\nconsole.log(count());`,
    });
    expect(await run([...cmd, "entry.ts"], {}, String(dir))).toEqual({
      stdout: expect.stringContaining(`console.log(${count});`),
      stderr: "",
      exitCode: 0,
    });
  });

  test("a request succeeds with the server's CA in $SSL_CERT_FILE", async () => {
    using dir = tempDir("use-openssl-ca-localhost", { "ca.pem": localhost.cert });
    using server = serve({ port: 0, tls: localhost, fetch: () => new Response("hello") });
    expect(
      await run([flag, "-e", `console.log(await (await fetch("https://localhost:${server.port}")).text());`], {
        SSL_CERT_FILE: join(String(dir), "ca.pem"),
      }),
    ).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
  });

  // Only the system store has a file of $SSL_CERT_DIR that is not named after the certificate's hash.
  test.skipIf(!isLinux).each([
    [[], "hello"],
    [[flag], untrusted],
  ])(
    "with NODE_USE_SYSTEM_CA=1 and %j, a request to a server with its CA in the system store gives %s",
    async (flags, expected) => {
      using dir = tempDir("use-openssl-ca-system", { "ca.pem": localhost.cert });
      using server = serve({ port: 0, tls: localhost, fetch: () => new Response("hello") });
      const script = `console.log(await fetch("https://localhost:${server.port}").then(response => response.text(), error => error.code));`;
      expect(await run([...flags, "-e", script], { NODE_USE_SYSTEM_CA: "1", SSL_CERT_DIR: String(dir) })).toEqual({
        stdout: expected + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // $SSL_CERT_FILE is there to be left out: as in Node, the list has nothing from OpenSSL's default paths. On Linux it
  // is also what the system store holds.
  test.each([
    ["nothing", {}, {}, 0],
    ["nothing with NODE_USE_SYSTEM_CA=1", { NODE_USE_SYSTEM_CA: "1" }, {}, 0],
    ["nothing with NODE_USE_SYSTEM_CA=1 in .env", {}, { ".env": "NODE_USE_SYSTEM_CA=1" }, 0],
    ["only $NODE_EXTRA_CA_CERTS", { NODE_EXTRA_CA_CERTS: ca1 }, {}, 1],
  ])("tls.getCACertificates('default') lists %s", async (_, env, files, count) => {
    using dir = tempDir("use-openssl-ca-list", files);
    const script = `const tls = require("node:tls");
      const list = tls.getCACertificates("default");
      console.log(JSON.stringify({
        default: list.length,
        isExtra: Bun.deepEquals(list, tls.getCACertificates("extra")),
        bundled: tls.getCACertificates("bundled").length,
        rootCertificates: tls.rootCertificates.length,
      }));`;
    const { stdout, stderr, exitCode } = await run([flag, "-e", script], { SSL_CERT_FILE: ca1, ...env }, String(dir));
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: {
        default: count,
        isExtra: true,
        bundled: rootCertificates.length,
        rootCertificates: rootCertificates.length,
      },
      stderr: "",
      exitCode: 0,
    });
  });
});
