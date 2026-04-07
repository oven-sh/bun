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
//  1. Every manifest line matches /^[0-9a-f]{64} \*(.+)$/ — the helper
//     emits `hex *name` exclusively (binary-mode marker), so the test
//     regex is pinned to that form rather than the permissive
//     validator regex that also accepts the text-mode `hex  name`.
//  2. The sha256 in the manifest equals the sha256 of the actual file
//  3. The body of the clearsigned .asc is byte-identical to the .txt
//  4. The PGP signature verifies against the signing key
//
// The unsigned rollout fallback (exit 0 with a fresh SHASUMS256.txt and
// no .asc when GPG env vars are absent) is also exercised, along with
// the signed-then-unsigned-in-same-dir path where a stale .asc from a
// previous signed run must be removed before the unsigned upload so a
// caller running `ls SHASUMS256.txt.asc` cannot find one left behind.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const script = join(repoRoot, "scripts", "sign-release-manifest.sh");

// Shared manifest-line regex. Pinned to `hex *name` (the only form
// scripts/sign-release-manifest.sh ever emits — see its `printf '%s
// *%s\n'` at the sha256 collation loop) rather than the validator
// regex /^([a-f0-9]{64})(  | \*)(.+)$/ which also accepts text mode.
// Pinning the test to the strict form means any future helper change
// that drops the `*` marker or switches to text mode would be caught
// here instead of silently passing under the permissive validator.
const manifestLineRe = /^([a-f0-9]{64}) \*(.+)$/;

async function sh(cmd: string[], env: Record<string, string> = {}) {
  // Async Bun.spawn (not spawnSync) so the wrapping describe.concurrent
  // below can actually run the five tests in parallel — a spawnSync
  // in each would block the test runner's event loop and defeat the
  // concurrency marker. Await the completion, then read stdout/stderr.
  await using proc = Bun.spawn({
    cmd,
    // Pin cwd to the repo root so the helper is robust against whatever
    // directory the test runner happens to be invoked from. Every path
    // in this file is already absolute, so this is defensive rather than
    // load-bearing, but it keeps the pattern consistent.
    cwd: repoRoot,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { exitCode, stdout, stderr };
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

describe.concurrent.skipIf(!canRun)("sign-release-manifest.sh (#28931)", () => {
  beforeAll(async () => {
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

    const gen = await sh(
      ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase", passphrase, "--gen-key", keyspecPath],
      { GNUPGHOME: gpgHome },
    );
    // Exit code is the reliable success signal; the later secret-key
    // export (which would fail loudly if no key exists) covers the
    // "did gen actually produce a key" question. Don't probe stdout/
    // stderr for an English "error" token — a diagnostic about a
    // temp path that happens to contain that substring would flake
    // the suite for no reason.
    expect(gen.exitCode).toBe(0);

    const exp = await sh(
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
    // stderr ONLY — exp.stdout holds the ASCII-armored private key and
    // can legitimately contain the substring "error" inside base64 key
    // material. Checking stdout would be a flake source.
    expect(exp.stderr).not.toContain("error");
    gpgPrivateKey = exp.stdout;
    expect(gpgPrivateKey).toContain("-----BEGIN PGP PRIVATE KEY BLOCK-----");
    expect(exp.exitCode).toBe(0);
  });

  afterAll(async () => {
    // Kill any gpg-agent bound to the throwaway GNUPGHOME before the
    // tempDir removal. `gpg --gen-key` / `--export-secret-keys` can
    // leave an agent running against this home whose socket lives
    // inside the directory we're about to rm -rf; removing the
    // directory out from under a live agent produces noisy "can't
    // connect to agent" stderr on the next GNUPGHOME=... call and,
    // on macOS, can leak the agent process past the test run. Mirrors
    // the same `GNUPGHOME=... gpgconf --kill all` cleanup the helper
    // itself performs before tearing down its per-run scratch dir.
    if (gpgHome) {
      await sh(["gpgconf", "--kill", "all"], { GNUPGHOME: gpgHome });
    }
    // Dispose the shared keyring manually — see the beforeAll comment
    // for why a `using` wouldn't work here.
    keyringDir?.[Symbol.dispose]();
    keyringDir = undefined;
  });

  test("writes deterministic, sorted SHASUMS256.txt and a matching clearsigned .asc", async () => {
    using dir = tempDir("bun-28931-manifest-", {
      "bun-linux-x64.zip": "fake linux x64 contents",
      "bun-darwin-aarch64.zip": "fake darwin aarch64 contents",
      "bun-windows-x64.zip": "fake windows x64 contents",
    });
    const dirStr = String(dir);

    const res = await sh(
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

    // --- Line format check (stricter than validate-digests.ts on
    // purpose — the helper always emits `hex *name`, so any drift
    // away from the binary-mode marker fails here).
    const lines = manifest.trim().split(/\r?\n/);
    const entries: { hex: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const m = line.match(manifestLineRe);
      expect(m).not.toBeNull();
      const [, hex, name] = m!;
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

    // --- Identity check: signed body == raw manifest, byte-exact ---
    // Parse the clearsign envelope rigorously instead of trimming both
    // sides into agreement: a lax assertion would silently pass if the
    // helper regressed to GPG's default digest algorithm, or if the
    // .asc and .txt differed only by trailing whitespace. Both failure
    // modes are real integrity regressions the downstream validator
    // would catch, so assert them here.
    //
    // The regex captures two groups:
    //  1. The `Hash: ...` value — pinned to SHA512 because the helper
    //     explicitly passes `--digest-algo SHA512`, matching the
    //     production .asc emitted by the daily cron. A regression that
    //     dropped the flag would fall back to gpg's default (SHA256)
    //     and be caught here.
    //  2. The body bytes between the blank line after the Hash header
    //     and the `-----BEGIN PGP SIGNATURE-----` marker — byte-exact,
    //     no .trim(), no .replace(). Must equal the manifest file on
    //     disk to satisfy the identity contract.
    const clearsigned = signed.match(
      /^-----BEGIN PGP SIGNED MESSAGE-----\r?\nHash: ([^\r\n]+)\r?\n\r?\n([\s\S]*?)-----BEGIN PGP SIGNATURE-----/m,
    );
    expect(clearsigned).not.toBeNull();
    const [, hashHeader, body] = clearsigned!;
    expect(hashHeader).toBe("SHA512");
    expect(body).toBe(manifest);

    // --- Signature must verify against the signing key ---
    using verifyHomeDir = tempDir("bun-28931-verify-", {});
    const verifyHome = String(verifyHomeDir);

    const pubRes = await sh(["gpg", "--armor", "--export", keyUid], { GNUPGHOME: gpgHome });
    // stderr first so a key lookup failure surfaces the real gpg error.
    expect(pubRes.stderr).not.toContain("error:");
    expect(pubRes.exitCode).toBe(0);
    const pubPath = join(verifyHome, "pub.asc");
    writeFileSync(pubPath, pubRes.stdout);

    const imp = await sh(["gpg", "--batch", "--import", pubPath], { GNUPGHOME: verifyHome });
    expect(imp.stderr).not.toContain("error:");
    expect(imp.exitCode).toBe(0);

    const verify = await sh(["gpg", "--batch", "--verify", join(dirStr, "SHASUMS256.txt.asc")], {
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

  test("writes unsigned SHASUMS256.txt when GPG env vars are empty (rollout fallback)", async () => {
    // Before the Buildkite GPG secrets are provisioned, the helper still
    // produces a fresh accurate SHASUMS256.txt — users running
    // `sha256sum -c` get correct hashes immediately and the daily sign
    // cron catches up with a matching .asc within 24h.
    using dir = tempDir("bun-28931-unsigned-", {
      "bun-linux-x64.zip": "fake-linux",
      "bun-darwin-aarch64.zip": "fake-darwin",
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, "bun-linux-x64.zip", "bun-darwin-aarch64.zip"], {
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
    // Track the basenames so we can assert the exact set and order
    // at the end of the loop — not just "some names that hash right".
    // A helper that duplicated one artifact and omitted the other
    // would still pass the hash check below but fail the basename
    // assertion. Matches the explicit basename check in the signed
    // test above.
    const names: string[] = [];
    for (const line of lines) {
      const m = line.match(manifestLineRe);
      expect(m).not.toBeNull();
      const [, hex, name] = m!;
      names.push(name);
      const expected = createHash("sha256")
        .update(readFileSync(join(dirStr, name)))
        .digest("hex");
      expect(hex).toBe(expected);
    }
    expect(names).toEqual(["bun-darwin-aarch64.zip", "bun-linux-x64.zip"]);

    // .asc must NOT exist — we intentionally upload an unsigned manifest
    // in this path. The daily cron handles re-signing.
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
  });

  test.each([
    ["key only", "placeholder-key-material", "", /GPG_PRIVATE_KEY is set but GPG_PASSPHRASE is empty/],
    ["passphrase only", "", passphrase, /GPG_PASSPHRASE is set but GPG_PRIVATE_KEY is empty/],
  ])("rejects partial GPG secret configuration (%s)", async (_label, key, pass, errorRe) => {
    // A lone GPG_PRIVATE_KEY or lone GPG_PASSPHRASE is almost always
    // a typo in a secret name or a half-completed provisioning, not
    // a legitimate rollout state. The helper must fail hard before
    // any output mutation, so the buildkite wrapper treats it as a
    // signing failure instead of silently degrading to the unsigned
    // path and publishing an unsigned manifest that looks like an
    // intentional rollout — which would silently recreate the exact
    // .txt/.asc divergence this PR exists to eliminate.
    using dir = tempDir("bun-28931-partial-", {
      "bun-linux-x64.zip": "present",
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, "bun-linux-x64.zip"], {
      // At least one of these is a nonempty placeholder; function of the
      // test case selects which. Actual signing is never attempted.
      GPG_PRIVATE_KEY: key,
      GPG_PASSPHRASE: pass,
    });
    expect(res.stderr).toMatch(errorRe);
    expect(res.stderr).toContain("both must be set to sign, or both unset");
    expect(res.exitCode).toBe(1);

    // No output mutation whatsoever — the rejection fires before the
    // cleanup trap is installed and before any manifest is written.
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
    // And no scratch dir was created.
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);
  });

  test("unsigned fallback removes a stale .asc left by a previous signed run", async () => {
    // A signed run writes .txt + .asc; if the same directory is later
    // invoked unsigned (secrets rotated/removed, standalone manual
    // re-run, etc.) an old .asc surviving into the next run would let
    // the buildkite wrapper's `[ -f SHASUMS256.txt.asc ]` check upload
    // a stale signature alongside the fresh .txt — exactly the
    // identity mismatch this PR exists to fix. The helper must remove
    // any preexisting .asc before the unsigned branch exits.
    using dir = tempDir("bun-28931-stale-asc-", {
      "bun-linux-x64.zip": "fake",
    });
    const dirStr = String(dir);

    // First run: signed.
    const firstRun = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    expect(firstRun.stderr).not.toContain("error:");
    expect(firstRun.exitCode).toBe(0);
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(true);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(true);

    // Change the artifact bytes so the second run's manifest differs from
    // the first — any stale .asc that survives would now reference the
    // wrong hashes and be caught by a strict validator.
    writeFileSync(join(dirStr, "bun-linux-x64.zip"), "fake-after-rotation");

    // Second run: unsigned. The .asc from the first run must be gone.
    const secondRun = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: "",
      GPG_PASSPHRASE: "",
    });
    expect(secondRun.stderr).toContain("wrote SHASUMS256.txt");
    expect(secondRun.stderr).not.toContain("error:");
    expect(secondRun.exitCode).toBe(0);
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(true);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);

    // And the fresh .txt must reflect the rotated bytes.
    const manifest = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8").trim();
    const expected = createHash("sha256").update("fake-after-rotation").digest("hex");
    expect(manifest).toBe(`${expected} *bun-linux-x64.zip`);
  });

  test("sweeps orphaned .sign-manifest-scratch.* dirs left by a SIGKILL'd prior run", async () => {
    // The normal cleanup() trap fires on every exit path, but SIGKILL
    // (OOM, agent restart, panic) skips it — leaving a stale scratch
    // dir in ${dir}. In Buildkite's reused-workspace model those
    // orphans would accumulate until the workspace itself is wiped.
    // The script sweeps ${dir}/${scratch_prefix}*/ on startup so each
    // run inherits a clean slate. Simulate the SIGKILL case by
    // planting an orphan directory with content inside, then invoke
    // the helper and assert the orphan is gone afterward.
    using dir = tempDir("bun-28931-stale-scratch-", {
      "bun-linux-x64.zip": "artifact-bytes",
    });
    const dirStr = String(dir);

    // Plant an orphan scratch dir with a recognizable marker file, plus
    // a second orphan so we prove the sweep handles more than one.
    const orphan1 = join(dirStr, ".sign-manifest-scratch.orphan01");
    const orphan2 = join(dirStr, ".sign-manifest-scratch.orphan02");
    mkdirSync(orphan1);
    mkdirSync(orphan2);
    writeFileSync(join(orphan1, "leftover.tmp"), "half-written-manifest");
    writeFileSync(join(orphan2, "gnupghome.fake"), "stale-keyring-bytes");
    expect(existsSync(orphan1)).toBe(true);
    expect(existsSync(orphan2)).toBe(true);

    const res = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: "",
      GPG_PASSPHRASE: "",
    });
    expect(res.stderr).not.toContain("error:");
    expect(res.exitCode).toBe(0);

    // Both orphans must be gone — swept before the helper's own
    // scratch_dir mktemp ran. The helper's own scratch dir was
    // removed by its cleanup trap on a successful exit, so the only
    // scratch-prefix directories left should be... none.
    expect(existsSync(orphan1)).toBe(false);
    expect(existsSync(orphan2)).toBe(false);
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);

    // And the manifest is still correct for the real artifact.
    const manifest = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8").trim();
    const expected = createHash("sha256").update("artifact-bytes").digest("hex");
    expect(manifest).toBe(`${expected} *bun-linux-x64.zip`);
  });

  test("sweep restores .bak files from an orphaned scratch dir when live outputs are missing", async () => {
    // Follow-up bug found on the original sweep: a prior run that was
    // SIGKILLed AFTER renaming the live SHASUMS256.txt / .asc into
    // its scratch dir (as `.bak` rollback copies) but BEFORE publishing
    // new outputs would leave the directory with no live manifest and
    // the only surviving copies sitting inside the orphan. A naive
    // sweep would delete them; the fix makes the sweep probe each
    // orphan for `.bak` files first, promote them back into the live
    // paths if live is missing, and only then rm -rf the orphan.
    //
    // Drive the sweep's restore through the full rollback chain:
    //   1. Plant orphan .bak files with distinctive bytes.
    //   2. Invoke the helper with a valid artifact but a bogus GPG
    //      key that fails gpg --import.
    //   3. The helper must: validate artifact → install trap → sweep
    //      and restore .bak → create scratch_dir → re-backup the just-
    //      restored file → hash/collate/publish new manifest → try to
    //      sign → gpg --import fails → cleanup rolls back: rm the new
    //      manifest, restore the (just-re-backed-up) original bytes.
    //   4. Final state: live SHASUMS256.txt/.asc exist and hold the
    //      ORIGINAL .bak bytes, not the new ones.
    using dir = tempDir("bun-28931-bak-restore-", {
      "bun-linux-x64.zip": "fresh-bytes",
    });
    const dirStr = String(dir);

    const orphan = join(dirStr, ".sign-manifest-scratch.orphanXX");
    mkdirSync(orphan);
    // Original (pre-SIGKILL) manifest and .asc bytes. Use distinctive
    // values so we can tell which ones the helper kept at the end.
    const originalTxt = Buffer.alloc(64, "deadbeef").toString() + " *bun-linux-x64.zip\n";
    const originalAsc =
      "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nstashed-bytes\n-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n";
    writeFileSync(join(orphan, "SHASUMS256.txt.bak"), originalTxt);
    writeFileSync(join(orphan, "SHASUMS256.txt.asc.bak"), originalAsc);

    // Live outputs are MISSING — simulating the exact SIGKILL window
    // between "mv manifest → scratch_dir/.bak" and "mv tmp → manifest".
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);

    // Valid artifact, bogus GPG key → helper runs the sweep, publishes
    // a fresh manifest, then fails gpg --import and rolls back.
    const res = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: "not-a-valid-pgp-key",
      GPG_PASSPHRASE: "unused",
    });
    expect(res.stderr).toMatch(/^gpg: /m);
    expect(res.exitCode).not.toBe(0);

    // Final state: live files exist and hold the ORIGINAL bytes from
    // the orphan. If the sweep had blindly rm -rf'd the orphan, these
    // files would be missing entirely after the rollback (the cleanup
    // trap would find empty backup_* vars and nothing to restore).
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(true);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(true);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8")).toBe(originalTxt);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt.asc"), "utf8")).toBe(originalAsc);
    // Orphan directory itself is gone, and the current run's scratch
    // dir was also torn down by cleanup().
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);
  });

  test("sweep picks the newest .bak when multiple orphaned scratch dirs each hold one", async () => {
    // Multi-orphan selection: two separate SIGKILL'd runs can each
    // leave an orphan containing a `.bak`. Without mtime-aware
    // selection the first-glob-match wins, which silently discards
    // the newer version if its mktemp suffix sorts after an older
    // one. The sweep must probe both, pick the newest via POSIX
    // `[ A -nt B ]`, and restore that one — leaving the older
    // orphan's .bak to be wiped with its directory.
    //
    // Plant two orphans with deliberately different mtimes (set via
    // utimesSync) and distinctive .bak bytes. Run the helper with a
    // bogus GPG key so it publishes a new manifest and then fails
    // gpg --import, driving the full restore → re-backup → rollback
    // chain. Final live bytes must be the NEWER orphan's content.
    using dir = tempDir("bun-28931-multi-orphan-", {
      "bun-linux-x64.zip": "fresh",
    });
    const dirStr = String(dir);

    // Two orphans whose alphabetical order is the OPPOSITE of their
    // mtime order. The alphabetically-first orphan (`orphan_aa`) is
    // mtime-OLDER; the alphabetically-last orphan (`orphan_zz`) is
    // mtime-NEWER. This orientation is load-bearing for the regression
    // signal: bash glob expansion walks orphan_aa first, so a broken
    // first-glob-wins implementation would pick orphan_aa's (older)
    // bytes and fail the final assertion; only an mtime-aware loop
    // using `[ A -nt B ]` keeps walking and swaps to orphan_zz's
    // (newer) bytes. A prior version of this test had the names
    // swapped — `orphan_aa` alphabetically first AND mtime-newer —
    // which a broken first-wins impl would ALSO pick correctly,
    // making the test a silent false positive.
    const orphanOlder = join(dirStr, ".sign-manifest-scratch.orphan_aa");
    const orphanNewer = join(dirStr, ".sign-manifest-scratch.orphan_zz");
    mkdirSync(orphanOlder);
    mkdirSync(orphanNewer);

    const olderTxt = Buffer.alloc(64, "a").toString() + " *bun-linux-x64.zip\n";
    const newerTxt = Buffer.alloc(64, "b").toString() + " *bun-linux-x64.zip\n";
    const olderAsc =
      "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nolder\n-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n";
    const newerAsc =
      "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nnewer\n-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n";
    writeFileSync(join(orphanOlder, "SHASUMS256.txt.bak"), olderTxt);
    writeFileSync(join(orphanOlder, "SHASUMS256.txt.asc.bak"), olderAsc);
    writeFileSync(join(orphanNewer, "SHASUMS256.txt.bak"), newerTxt);
    writeFileSync(join(orphanNewer, "SHASUMS256.txt.asc.bak"), newerAsc);

    // Force mtimes to match the naming: `orphan_aa` gets the old
    // timestamp, `orphan_zz` gets the fresh one. 1000s gap is well
    // above any plausible filesystem mtime granularity so `-nt`
    // always sees orphan_zz as strictly newer.
    const now = Math.floor(Date.now() / 1000);
    utimesSync(join(orphanOlder, "SHASUMS256.txt.bak"), now - 1000, now - 1000);
    utimesSync(join(orphanOlder, "SHASUMS256.txt.asc.bak"), now - 1000, now - 1000);
    utimesSync(join(orphanNewer, "SHASUMS256.txt.bak"), now, now);
    utimesSync(join(orphanNewer, "SHASUMS256.txt.asc.bak"), now, now);

    // Live outputs missing — sweep must restore from orphans.
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);

    const res = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: "not-a-valid-pgp-key",
      GPG_PASSPHRASE: "unused",
    });
    expect(res.stderr).toMatch(/^gpg: /m);
    expect(res.exitCode).not.toBe(0);

    // The NEWER orphan's bytes must have won the restore, then been
    // re-backed-up by the current run, then restored through the
    // cleanup rollback when gpg --import failed.
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(true);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(true);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8")).toBe(newerTxt);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt.asc"), "utf8")).toBe(newerAsc);

    // Both orphan directories are gone (the older one still had its
    // .bak when it was rm'd — no manual recovery needed because the
    // newer orphan's copy is what matters).
    expect(existsSync(orphanOlder)).toBe(false);
    expect(existsSync(orphanNewer)).toBe(false);
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);
  });

  test("sweep does not clobber live outputs with an orphaned .bak", async () => {
    // Opposite branch of the orphan-restore tests above: when the live
    // SHASUMS256.txt / .asc already exist (e.g. a prior run completed
    // normally and cleanup() left the outputs in place), the sweep must
    // treat orphaned `.bak` copies as stale and NOT copy them over the
    // live files. The helper's `! [ -e "${manifest}" ]` guard on the
    // restore `mv` enforces this; without the guard, an old orphan
    // would silently overwrite a valid live manifest with obsolete
    // bytes every time the helper ran.
    //
    // Setup: pre-populate live .txt/.asc with distinctive "live-wins"
    // bytes, plant an orphan scratch dir whose .bak files hold
    // different "should-not-win" bytes, then run the helper with a
    // bogus GPG key so it exercises the sweep → mutation → rollback
    // path without overwriting the live outputs. The assertion is
    // that after the run, the live files still hold the original
    // "live-wins" bytes and the orphan directory is gone.
    using dir = tempDir("bun-28931-live-wins-", {
      "bun-linux-x64.zip": "fresh-bytes",
    });
    const dirStr = String(dir);

    const liveTxt = Buffer.alloc(64, "c").toString() + " *bun-linux-x64.zip\n";
    const liveAsc =
      "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nlive-wins\n-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n";
    writeFileSync(join(dirStr, "SHASUMS256.txt"), liveTxt);
    writeFileSync(join(dirStr, "SHASUMS256.txt.asc"), liveAsc);

    const orphan = join(dirStr, ".sign-manifest-scratch.orphanLL");
    mkdirSync(orphan);
    const staleTxt = Buffer.alloc(64, "d").toString() + " *bun-linux-x64.zip\n";
    const staleAsc =
      "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nshould-not-win\n-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n";
    writeFileSync(join(orphan, "SHASUMS256.txt.bak"), staleTxt);
    writeFileSync(join(orphan, "SHASUMS256.txt.asc.bak"), staleAsc);

    // Bogus GPG key so the helper:
    //   1. runs the sweep (must NOT restore the orphan .bak over live)
    //   2. renames live .txt/.asc into its own scratch dir as backups
    //   3. publishes a fresh manifest
    //   4. fails gpg --import
    //   5. cleanup() rolls back: rm new manifest, restore backups
    // Final live bytes must equal the original liveTxt/liveAsc — not
    // the staleTxt/staleAsc bytes from the orphan.
    const res = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: "not-a-valid-pgp-key",
      GPG_PASSPHRASE: "unused",
    });
    expect(res.stderr).toMatch(/^gpg: /m);
    expect(res.exitCode).not.toBe(0);

    expect(readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8")).toBe(liveTxt);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt.asc"), "utf8")).toBe(liveAsc);

    // Orphan is gone, current run's scratch dir also torn down.
    expect(existsSync(orphan)).toBe(false);
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);
  });

  test("restores pre-existing valid outputs when a later step fails mid-mutation", async () => {
    // The cleanup() trap's own invariant promises "same state on
    // failure", but a naive `rm -f "$signed_manifest"` + `mv tmp
    // "$manifest"` sequence would wipe pre-existing valid outputs if a
    // later step (e.g. gpg --import on a bad key) fails. The helper
    // renames any pre-existing .txt/.asc into the scratch dir as
    // backups before mutation and restores them from cleanup() when
    // success stays 0. This test exercises that rollback by running a
    // successful signed first pass, then invoking the helper a second
    // time with a bogus GPG key so gpg --import aborts mid-mutation.
    // Both the .txt and .asc from the first run must be present and
    // byte-identical after the failure.
    using dir = tempDir("bun-28931-rollback-", {
      "bun-linux-x64.zip": "v1 bytes",
    });
    const dirStr = String(dir);

    // First run: signed. Produces the valid state we want preserved.
    const first = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);
    const originalTxt = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8");
    const originalAsc = readFileSync(join(dirStr, "SHASUMS256.txt.asc"), "utf8");
    expect(originalTxt).toContain("bun-linux-x64.zip");
    expect(originalAsc).toContain("-----BEGIN PGP SIGNED MESSAGE-----");

    // Rewrite the artifact so a successful rerun WOULD produce different
    // hashes — if the helper doesn't roll back, our assertion that the
    // .txt is byte-identical will catch it.
    writeFileSync(join(dirStr, "bun-linux-x64.zip"), "v2 bytes");

    // Second run: a bogus GPG key makes `gpg --import <<< $GPG_PRIVATE_KEY`
    // fail inside the mutation phase, AFTER the manifest has been written
    // and backed up. The cleanup trap must restore the backups.
    const second = await sh([script, dirStr, "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: "not-a-valid-pgp-key",
      GPG_PASSPHRASE: passphrase,
    });
    // stderr before exitCode (CLAUDE.md) so a surprise exit 0 gets a
    // legible failure message instead of "expected 0 not to be 0".
    // Also a positive assertion: the gpg --import failure must surface
    // on stderr rather than get swallowed silently inside the helper.
    // gpg always prefixes its diagnostics with "gpg:" (it's the program
    // identifier, stable across every version from 2.x onward), and on
    // this specific bad input it prints "gpg: no valid OpenPGP data
    // found." The regex matches the prefix alone so future gpg wording
    // drift doesn't flake the test.
    expect(second.stderr).toMatch(/^gpg: /m);
    expect(second.exitCode).not.toBe(0);

    // Pre-existing state must be restored byte-for-byte. No half-written
    // v2 manifest, no orphaned scratch files left in the directory.
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(true);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(true);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8")).toBe(originalTxt);
    expect(readFileSync(join(dirStr, "SHASUMS256.txt.asc"), "utf8")).toBe(originalAsc);

    // No scratch leftovers: cleanup() removes the per-invocation
    // `.sign-manifest-scratch.XXXXXXXX/` subdirectory (which contains
    // every .tmp, .bak, and sorted-list file) on both success and
    // failure paths, so the directory should contain exactly the
    // originals. Filter in-process via readdirSync rather than
    // shelling out to `ls | grep` — per the harness guideline and
    // the describe.concurrent contract documented on sh() above, a
    // Bun.spawnSync call in this test would block the event loop.
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);
  });

  test("fails loudly and cleans up a half-written manifest when an artifact is missing", async () => {
    using dir = tempDir("bun-28931-missing-", {
      "bun-linux-x64.zip": "present",
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, "bun-linux-x64.zip", "bun-windows-x64.zip"], {
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

  test.each([
    ["with slash", "dist/bun-linux-x64.zip"],
    ["parent traversal", "../bun-linux-x64.zip"],
    ["dot-dot", ".."],
    ["dot", "."],
    ["empty", ""],
  ])("rejects non-basename artifact %s", async (_label, badName) => {
    // Helper contract is basename-only — a caller passing `dist/foo.zip`
    // would try to write its digest under a missing subdir, and
    // `../foo.zip` would escape the scratch dir entirely. Validate up
    // front so the error surfaces as "must be basenames" and no files
    // are produced.
    using dir = tempDir("bun-28931-basename-", {
      "bun-linux-x64.zip": "present",
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, badName], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    expect(res.stderr).toContain("must be basenames");
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
    expect(res.exitCode).toBe(1);
  });

  test("accepts SHASUMS256.txt.tmp as a legitimate artifact and preserves its bytes", async () => {
    // Historical regression: a previous iteration of the helper wrote
    // its intermediate manifest to `${dir}/SHASUMS256.txt.tmp`, so
    // accepting a caller file with that basename would have truncated
    // it in place via `: > "${tmp_manifest}"` during collation. The
    // scratch_dir refactor moves every intermediate (.tmp, .bak,
    // sorted list) into `${dir}/.sign-manifest-scratch.XXXXXXXX/`, so
    // `SHASUMS256.txt.tmp` is just a normal artifact now — the helper
    // hashes it, lists it in the manifest, and leaves the file
    // byte-for-byte unchanged.
    const originalBytes = "CALLER_ORIGINAL_DATA_MUST_NOT_BE_CLOBBERED\n";
    using dir = tempDir("bun-28931-tmp-artifact-", {
      "bun-linux-x64.zip": "present",
      "SHASUMS256.txt.tmp": originalBytes,
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, "bun-linux-x64.zip", "SHASUMS256.txt.tmp"], {
      GPG_PRIVATE_KEY: "",
      GPG_PASSPHRASE: "",
    });
    expect(res.stderr).not.toContain("error:");
    expect(res.exitCode).toBe(0);

    // The caller's SHASUMS256.txt.tmp file is byte-identical to what
    // they passed in.
    expect(readFileSync(join(dirStr, "SHASUMS256.txt.tmp"), "utf8")).toBe(originalBytes);
    // And the generated manifest records both artifacts, with a hash
    // of the original `SHASUMS256.txt.tmp` bytes (not some corrupted
    // intermediate).
    const manifest = readFileSync(join(dirStr, "SHASUMS256.txt"), "utf8").trim();
    const expectedTmp = createHash("sha256").update(originalBytes).digest("hex");
    expect(manifest).toContain(`${expectedTmp} *SHASUMS256.txt.tmp`);
    expect(manifest).toContain("*bun-linux-x64.zip");
    // No scratch leftovers.
    const leftovers = readdirSync(dirStr).filter(name => name.startsWith(".sign-manifest-scratch."));
    expect(leftovers).toEqual([]);
  });

  test("rejects duplicate basenames in the artifact list", async () => {
    // A repeated basename would launch two parallel hash jobs writing
    // to the same `$hash_dir/$artifact.digest` path (last-write wins,
    // racy) and the collation loop would emit the same archive twice,
    // producing a manifest downstream `sha256sum -c` tooling would parse
    // as two identical entries. Reject up front in the validation pass.
    using dir = tempDir("bun-28931-dup-", {
      "bun-linux-x64.zip": "present",
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, "bun-linux-x64.zip", "bun-linux-x64.zip"], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    expect(res.stderr).toContain("duplicate artifact");
    expect(res.exitCode).toBe(1);
    // No partial state — validation fires before the mutation phase
    // even installs its cleanup trap, so the caller's pre-existing
    // state (or lack thereof) is strictly untouched.
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
  });

  test.each([
    ["reserved manifest name", "SHASUMS256.txt", /reserved for manifest output/],
    ["reserved signed-manifest name", "SHASUMS256.txt.asc", /reserved for manifest output/],
    ["scratch prefix", ".sign-manifest-scratch.foo", /reserved for scratch directory/],
    ["scratch prefix (longer)", ".sign-manifest-scratch.ABCDEFGH/xyz", /must be basenames/],
    ["embedded newline", "bun-linux\n-x64.zip", /contains line break/],
    ["embedded carriage return", "bun-linux\r-x64.zip", /contains line break/],
  ])("rejects malformed artifact %s", async (_label, badName, errorRe) => {
    // These names would each break the script if accepted:
    // - "SHASUMS256.txt"/"SHASUMS256.txt.asc" are the script's own
    //   output paths — including them as inputs would compute a hash
    //   for the previous run's manifest and then clobber it.
    // - Any name starting with ".sign-manifest-scratch." is reserved
    //   for the per-invocation scratch subdirectory the helper
    //   creates under ${dir}. Accepting such a name as an artifact
    //   basename would risk the scratch-dir mkdir colliding with (or
    //   shadowing) the caller's file. The `/xyz` variant exercises
    //   the independent slash-rejection path, which fires before the
    //   reserved-name check.
    // - A newline or carriage return in the name splits the
    //   newline-delimited sort into multiple entries and writes a
    //   multi-line manifest entry that downstream parsers reject.
    using dir = tempDir("bun-28931-malformed-", {
      "bun-linux-x64.zip": "present",
    });
    const dirStr = String(dir);

    const res = await sh([script, dirStr, badName], {
      GPG_PRIVATE_KEY: gpgPrivateKey,
      GPG_PASSPHRASE: passphrase,
    });
    expect(res.stderr).toMatch(errorRe);
    expect(existsSync(join(dirStr, "SHASUMS256.txt"))).toBe(false);
    expect(existsSync(join(dirStr, "SHASUMS256.txt.asc"))).toBe(false);
    expect(res.exitCode).toBe(1);
  });

  test("representative archive set round-trips through validate-digests.ts checks", async () => {
    // End-to-end repro of the issue: running the helper over a set of
    // canary-shaped archive basenames yields a manifest whose hashes
    // match the real file bytes, so the user's validator script would
    // pass. The authoritative list of canary targets lives in
    // .buildkite/scripts/upload-release.sh; we don't mirror it here
    // because the helper is agnostic to the specific archive names and
    // parsing the shell array at test time would just create a new
    // fragile coupling. Five cross-OS basenames are enough to exercise
    // sorting, binary-mode separator, and the full round-trip.
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

    const res = await sh([script, dirStr, ...artifacts], {
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
      const m = line.match(manifestLineRe);
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
