// Regression test for https://github.com/oven-sh/bun/issues/28931
//
// The canary release kept serving a stale SHASUMS256.txt because the
// Buildkite upload script clobbered archives on every push to main while
// the GitHub Actions sign job only refreshed the manifest once a day.
//
// The fix extracts the generate+clearsign step into
// scripts/sign-release-manifest.sh and wires it into the Buildkite
// upload script right after every archive is uploaded. This test runs
// the helper against a throwaway GPG key and re-implements the exact
// checks from the user's validate-digests.ts:
//
//  1. Every manifest line matches /^[0-9a-f]{64}(  | \*)(.+)$/
//  2. The sha256 in the manifest equals the sha256 of the actual file
//  3. The body of the clearsigned .asc is byte-identical to the .txt
//  4. The PGP signature verifies against the signing key
//
// The helper's skip sentinel (exit 2 with no files written when GPG env
// vars are absent) is also exercised — that's the rollout fallback
// before the Buildkite GPG secrets are provisioned.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const script = join(repoRoot, "scripts", "sign-release-manifest.sh");

function sh(cmd: string[], env: Record<string, string> = {}) {
  const res = Bun.spawnSync({
    cmd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: res.exitCode,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
  };
}

// The signing helper is a bash script (uses set -eo pipefail, here-strings,
// GNUPGHOME, POSIX sha256sum / shasum) that runs on the Linux buildkite
// agent which performs the canary release upload. Nothing on Windows ever
// runs it, so there's no value exercising it there — Windows' gpg would
// be found on PATH (git-for-windows ships one) but posix_spawn on a .sh
// file fails outright.
const canRun =
  !isWindows && Bun.spawnSync({ cmd: ["gpg", "--version"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

// Throwaway GPG key material shared by every test below.
let keyringDir: ReturnType<typeof tempDir> | undefined;
let gpgHome = "";
let gpgPrivateKey = "";
const passphrase = "test-passphrase-28931";
const keyUid = "release-test-28931@example.invalid";

describe.skipIf(!canRun)("sign-release-manifest.sh (#28931)", () => {
  beforeAll(() => {
    // One keyring for the whole suite. We can't `using` this inside
    // beforeAll — the disposable would fire as soon as this callback
    // returns, wiping the keyring before any test runs. Stash the
    // handle and dispose it in afterAll instead.
    keyringDir = tempDir("bun-28931-keyring-", {});
    gpgHome = String(keyringDir);

    const keyspec = [
      "%echo Generating key",
      "Key-Type: EDDSA",
      "Key-Curve: ed25519",
      "Key-Usage: sign",
      "Name-Real: Bun Release Test",
      `Name-Email: ${keyUid}`,
      "Expire-Date: 0",
      `Passphrase: ${passphrase}`,
      "%commit",
      "%echo Done",
    ].join("\n");
    const keyspecPath = join(gpgHome, "keyspec");
    writeFileSync(keyspecPath, keyspec);

    const gen = sh(
      ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", passphrase, "--gen-key", keyspecPath],
      { GNUPGHOME: gpgHome },
    );
    expect(gen.stderr + gen.stdout).not.toContain("error");
    expect(gen.exitCode).toBe(0);

    const exp = sh(
      [
        "gpg",
        "--batch",
        "--pinentry-mode",
        "loopback",
        "--passphrase",
        passphrase,
        "--armor",
        "--export-secret-keys",
        keyUid,
      ],
      { GNUPGHOME: gpgHome },
    );
    expect(exp.exitCode).toBe(0);
    gpgPrivateKey = exp.stdout;
    expect(gpgPrivateKey).toContain("-----BEGIN PGP PRIVATE KEY BLOCK-----");
  });

  afterAll(() => {
    // Dispose the shared keyring manually — see the beforeAll comment
    // for why a `using` wouldn't work here.
    keyringDir?.[Symbol.dispose]();
    keyringDir = undefined;
  });

  test("writes deterministic, sorted SHASUMS256.txt and a matching clearsigned .asc", () => {
    using dir = tempDir("bun-28931-manifest-", {
      "bun-linux-x64.zip": "fake linux x64 contents",
      "bun-darwin-aarch64.zip": "fake darwin aarch64 contents",
      "bun-windows-x64.zip": "fake windows x64 contents",
    });
    const dirStr = String(dir);

    const res = sh(
      // Deliberately unsorted — the helper must sort for us.
      [script, dirStr, "bun-windows-x64.zip", "bun-linux-x64.zip", "bun-darwin-aarch64.zip"],
      { GPG_PRIVATE_KEY: gpgPrivateKey, GPG_PASSPHRASE: passphrase },
    );

    // stdout/stderr first so a failure surfaces the real error, not exit code.
    expect(res.stderr).not.toContain("error:");
    expect(res.stdout).not.toContain("error:");
    expect(res.exitCode).toBe(0);

    const manifest = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8");
    const signed = readFileSync(join(dirStr, "SHASUMS256.txt.asc"), "utf8");

    // --- Line format check (mirrors validate-digests.ts) ---
    const lines = manifest.trim().split(/\r?\n/);
    const lineRe = /^([a-f0-9]{64})(  | \*)(.+)$/;
    const entries: { hex: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const m = line.match(lineRe);
      expect(m).not.toBeNull();
      const [, hex, , name] = m!;
      expect(seen.has(name)).toBe(false);
      seen.add(name);
      entries.push({ hex, name });
    }

    // Sorted by filename (C-locale sort, matches `LC_ALL=C sort`).
    expect(entries.map(e => e.name)).toEqual(["bun-darwin-aarch64.zip", "bun-linux-x64.zip", "bun-windows-x64.zip"]);

    // --- Hashes must match the actual file bytes ---
    for (const { name, hex } of entries) {
      const bytes = readFileSync(join(dirStr, name));
      const expected = createHash("sha256").update(bytes).digest("hex");
      expect(hex).toBe(expected);
    }

    // --- Identity check: signed body == raw manifest ---
    // This is the exact transformation validate-digests.ts performs.
    const afterHeader = signed.split("-----BEGIN PGP SIGNATURE-----")[0];
    const body = afterHeader
      .split("-----BEGIN PGP SIGNED MESSAGE-----")[1]
      .replace(/^[\s\S]*?Hash: .*\r?\n\r?\n/, "")
      .trim();
    expect(body).toBe(manifest.trim());

    // --- Signature must verify against the signing key ---
    using verifyHomeDir = tempDir("bun-28931-verify-", {});
    const verifyHome = String(verifyHomeDir);

    const pubRes = sh(["gpg", "--armor", "--export", keyUid], { GNUPGHOME: gpgHome });
    expect(pubRes.exitCode).toBe(0);
    const pubPath = join(verifyHome, "pub.asc");
    writeFileSync(pubPath, pubRes.stdout);

    const imp = sh(["gpg", "--batch", "--import", pubPath], { GNUPGHOME: verifyHome });
    expect(imp.exitCode).toBe(0);

    const verify = sh(["gpg", "--batch", "--verify", join(dirStr, "SHASUMS256.txt.asc")], {
      GNUPGHOME: verifyHome,
      // Pin the locale — gpg translates "Good signature" to the system
      // language otherwise (e.g. "Korrekte Unterschrift" on a German dev
      // box), which would make the substring match below fail even though
      // the signature itself is cryptographically valid.
      LANG: "C",
      LC_ALL: "C",
      LC_MESSAGES: "C",
    });
    // gpg prints "Good signature" to stderr on success (locale pinned above).
    expect(verify.stderr).toContain("Good signature");
    expect(verify.exitCode).toBe(0);
  });

  test("writes unsigned SHASUMS256.txt when GPG env vars are empty (rollout fallback)", () => {
    // Before the Buildkite GPG secrets are provisioned, the helper still
    // produces a fresh accurate SHASUMS256.txt — users running
    // `sha256sum -c` get correct hashes immediately and the daily sign
    // cron catches up with a matching .asc within 24h.
    using dir = tempDir("bun-28931-unsigned-", {
      "bun-linux-x64.zip": "fake-linux",
      "bun-darwin-aarch64.zip": "fake-darwin",
    });
    const dirStr = String(dir);

    const res = sh([script, dirStr, "bun-linux-x64.zip", "bun-darwin-aarch64.zip"], {
      GPG_PRIVATE_KEY: "",
      GPG_PASSPHRASE: "",
    });
    expect(res.stderr).toContain("wrote SHASUMS256.txt");
    expect(res.stderr).toContain("without a signature");
    expect(res.stderr).not.toContain("error:");
    expect(res.exitCode).toBe(0);

    // Manifest must still be present and correct.
    const manifest = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8").trim();
    const lines = manifest.split(/\r?\n/);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const m = line.match(/^([a-f0-9]{64})  (.+)$/);
      expect(m).not.toBeNull();
      const [, hex, name] = m!;
      const expected = createHash("sha256").update(readFileSync(join(dirStr, name))).digest("hex");
      expect(hex).toBe(expected);
    }

    // .asc must NOT exist — we intentionally upload an unsigned manifest
    // in this path. The daily cron handles re-signing.
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
  });

  test("fails loudly and cleans up a half-written manifest when an artifact is missing", () => {
    using dir = tempDir("bun-28931-missing-", {
      "bun-linux-x64.zip": "present",
    });
    const dirStr = String(dir);

    const res = sh([script, dirStr, "bun-linux-x64.zip", "bun-windows-x64.zip"], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    expect(res.stderr).toContain("missing artifact");
    expect(res.exitCode).toBe(1);
    // Must not leave a truncated manifest behind — callers trust that
    // the file either contains the whole canonical list or does not exist.
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
  });

  test("full canary artifact set round-trips through validate-digests.ts checks", () => {
    // End-to-end repro of the issue: running the helper over the
    // canary archive list yields a manifest whose hashes match the real
    // file bytes, so the user's validator script would pass.
    using dir = tempDir("bun-28931-e2e-", {
      "bun-linux-x64.zip": "linux",
      "bun-linux-aarch64.zip": "linux-aarch64",
      "bun-darwin-x64.zip": "darwin-x64",
      "bun-darwin-aarch64.zip": "darwin-aarch64",
      "bun-windows-x64.zip": "windows-x64",
    });
    const dirStr = String(dir);
    const artifacts = [
      "bun-linux-x64.zip",
      "bun-linux-aarch64.zip",
      "bun-darwin-x64.zip",
      "bun-darwin-aarch64.zip",
      "bun-windows-x64.zip",
    ];

    const res = sh([script, dirStr, ...artifacts], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    // stdout/stderr first so a failure surfaces the real error, not exit code.
    expect(res.stderr).not.toContain("error:");
    expect(res.stdout).not.toContain("error:");
    expect(res.exitCode).toBe(0);

    const manifest = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8").trim();
    const lines = manifest.split(/\r?\n/);
    expect(lines.length).toBe(artifacts.length);

    // Validator: parse each line, resolve the file, compare sha256.
    const parsed = lines.map(line => {
      const m = line.match(/^([a-f0-9]{64})  (.+)$/);
      expect(m).not.toBeNull();
      return { hex: m![1], name: m![2] };
    });

    const expectedByName: Record<string, string> = {};
    for (const a of artifacts) {
      expectedByName[a] = createHash("sha256")
        .update(readFileSync(join(dirStr, a)))
        .digest("hex");
    }

    expect(parsed.reduce<Record<string, string>>((acc, p) => ((acc[p.name] = p.hex), acc), {})).toEqual(expectedByName);
  });
});
