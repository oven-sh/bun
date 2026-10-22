/**
 * `bun run rust:check-all` (scripts/rust-check-all.ts) runs `cargo check` for
 * every triple in allRustTargets. It only asks `rustup` what is installed and
 * runs `cargo`, so both are replaced by shell scripts on PATH here: rustup
 * answers from FAKE_TARGETS / FAKE_COMPONENTS (or is broken when
 * FAKE_RUSTUP_MISSING is set), cargo echoes its argv and fails for
 * FAKE_FAILING_TARGET. Shell-script fakes don't resolve as executables on
 * Windows, hence the skip.
 *
 * Each run loads the build scripts' module graph in a fresh process, which
 * takes a few seconds in a debug build, so the scenarios are packed into as
 * few runs as possible.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { allRustTargets, cargoBuildStdArg, rustTargetIsTier3 } from "../../scripts/build/rust.ts";

const script = join(import.meta.dir, "..", "..", "scripts", "rust-check-all.ts");

const fakeRustup = [
  "#!/bin/sh",
  '[ -n "$FAKE_RUSTUP_MISSING" ] && exit 127',
  'case "$1 $2 $3" in',
  "  \"target list --installed\") printf '%s\\n' $FAKE_TARGETS ;;",
  "  \"component list --installed\") printf '%s\\n' $FAKE_COMPONENTS ;;",
  "  *) exit 1 ;;",
  "esac",
  "",
].join("\n");

const fakeCargo = [
  "#!/bin/sh",
  'echo "cargo $*"',
  'for arg in "$@"; do [ -n "$FAKE_FAILING_TARGET" ] && [ "$arg" = "$FAKE_FAILING_TARGET" ] && exit 101; done',
  "exit 0",
  "",
].join("\n");

interface Fakes {
  targets?: string[];
  components?: string[];
  failingTarget?: string;
  rustupMissing?: boolean;
}

async function runCheckAll(args: string[], fakes: Fakes) {
  using dir = tempDir("rust-check-all", { "bin/rustup": fakeRustup, "bin/cargo": fakeCargo });
  const bin = join(String(dir), "bin");
  chmodSync(join(bin, "rustup"), 0o755);
  chmodSync(join(bin, "cargo"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), script, ...args],
    env: {
      ...bunEnv,
      PATH: `${bin}:${bunEnv.PATH}`,
      FAKE_TARGETS: (fakes.targets ?? []).join(" "),
      FAKE_COMPONENTS: (fakes.components ?? []).join(" "),
      FAKE_FAILING_TARGET: fakes.failingTarget ?? "",
      FAKE_RUSTUP_MISSING: fakes.rustupMissing ? "1" : "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The script's own lines and the cargo lines (inherited stdio) share the
  // pipe, so they are compared as a set; the summary line pins the counts.
  const lines = stdout
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter(line => line !== "")
    .sort();
  return { lines, stderr, exitCode };
}

const checkLine = (triple: string) => `[check] ${triple}${rustTargetIsTier3(triple) ? `  (${cargoBuildStdArg})` : ""}`;
const cargoLine = (triple: string) =>
  `cargo check --workspace --keep-going --target ${triple} --message-format=short${rustTargetIsTier3(triple) ? ` ${cargoBuildStdArg}` : ""}`;

describe.skipIf(isWindows)("rust:check-all", () => {
  test.concurrent(
    "checks the targets whose std is installed, says how to install the rest, and fails if any check failed",
    async () => {
      const { lines, stderr, exitCode } = await runCheckAll(
        ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "aarch64-apple-darwin", "aarch64-unknown-freebsd"],
        {
          targets: ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"],
          components: ["rustc-x86_64-unknown-linux-gnu", "rust-std-x86_64-unknown-linux-gnu"],
          failingTarget: "x86_64-unknown-linux-gnu",
        },
      );
      expect(stderr).toBe("");
      expect(lines).toEqual(
        [
          checkLine("x86_64-unknown-linux-gnu"),
          cargoLine("x86_64-unknown-linux-gnu"),
          // --keep-going across targets too: the failure above doesn't stop this one.
          checkLine("aarch64-unknown-linux-gnu"),
          cargoLine("aarch64-unknown-linux-gnu"),
          "[skip] aarch64-apple-darwin  (rustup target add aarch64-apple-darwin)",
          // Tier 3: there is no rust-std to add; -Zbuild-std wants rust-src instead.
          "[skip] aarch64-unknown-freebsd  (rustup component add rust-src)",
          "1 ok, 1 failed, 2 skipped (of 4)",
        ].sort(),
      );
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  test.concurrent(
    "with everything installed and no arguments, checks every triple, Tier 3 ones with -Zbuild-std",
    async () => {
      const { lines, stderr, exitCode } = await runCheckAll([], {
        targets: allRustTargets.filter(triple => !rustTargetIsTier3(triple)),
        components: ["rust-src"],
      });
      expect(stderr).toBe("");
      expect(lines).toEqual(
        [
          ...allRustTargets.map(checkLine),
          ...allRustTargets.map(cargoLine),
          `${allRustTargets.length} ok, 0 failed, 0 skipped (of ${allRustTargets.length})`,
        ].sort(),
      );
      expect(lines.filter(line => line.startsWith("cargo ") && line.endsWith(cargoBuildStdArg))).toEqual([
        cargoLine("aarch64-unknown-freebsd"),
      ]);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "without a working rustup nothing can be probed, so every requested target is attempted",
    async () => {
      const { lines, stderr, exitCode } = await runCheckAll(["aarch64-unknown-linux-gnu", "aarch64-unknown-freebsd"], {
        rustupMissing: true,
      });
      expect(stderr).toBe("");
      expect(lines).toEqual(
        [
          checkLine("aarch64-unknown-linux-gnu"),
          cargoLine("aarch64-unknown-linux-gnu"),
          checkLine("aarch64-unknown-freebsd"),
          cargoLine("aarch64-unknown-freebsd"),
          "2 ok, 0 failed, 0 skipped (of 2)",
        ].sort(),
      );
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  test.concurrent(
    "rejects a triple CI doesn't build",
    async () => {
      const { lines, stderr, exitCode } = await runCheckAll(["riscv64gc-unknown-linux-gnu"], {});
      expect(stderr).toContain("unknown target 'riscv64gc-unknown-linux-gnu'");
      for (const triple of allRustTargets) expect(stderr).toContain(triple);
      expect(lines).toEqual([]);
      expect(exitCode).toBe(2);
    },
    30_000,
  );
});
