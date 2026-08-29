import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
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
