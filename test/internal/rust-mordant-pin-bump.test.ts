/**
 * scripts/rust-mordant.ts runs cargo-dylint, which builds the lint pack pinned
 * under [workspace.metadata.dylint] out of cargo's checkout of the pinned rev
 * into <target>/dylint/libraries/, the same directory whatever the rev. Cargo
 * treats sources under $CARGO_HOME/git as immutable, so a library built there
 * before a rev bump still counts as fresh after it, and the bump gets triaged
 * against the previous rev's lints. The script has to discard the directory
 * itself whenever it cannot tell that the directory was built from the current
 * entries, and only then: a rebuild takes about a minute, and the workspace's
 * own check cache next to it is invalidated by dylint already.
 *
 * cargo and bun are stand-ins: `cargo metadata` answers from a file the test
 * rewrites to move the pin, `cargo dylint` only records that it ran, and bun
 * (the codegen step) does nothing. They are sh scripts, hence no Windows.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

const script = join(import.meta.dir, "..", "..", "scripts", "rust-mordant.ts");

test.skipIf(isWindows)("bumping the pinned lint pack discards the libraries built from the previous pin", async () => {
  using dir = tempDir("rust-mordant", {
    "bin/cargo": [
      "#!/bin/sh",
      'case "$1" in',
      '  metadata) cat "$MORDANT_TEST_DIR/cargo-metadata.json" ;;',
      '  dylint) [ "$2" = --version ] || echo "$*" >> "$MORDANT_TEST_DIR/dylint-runs" ;;',
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
    "bin/bun": "#!/bin/sh\n",
  });
  const root = String(dir);
  chmodSync(join(root, "bin", "cargo"), 0o755);
  chmodSync(join(root, "bin", "bun"), 0o755);

  const cargoMetadata = join(root, "cargo-metadata.json");
  const target = join(root, "target");
  const toolchain = "nightly-2026-05-28-x86_64-unknown-linux-gnu";
  const libraries = join(target, "dylint", "libraries");
  const builtFrom = join(libraries, "built-from.json");
  // Stands in for what cargo-dylint built from the pin in effect at the time.
  const library = join(libraries, toolchain, "release", "libmordant.so");
  // Part of dylint's check cache for the workspace, which is not the script's to discard.
  const checkCache = join(target, "dylint", "target", toolchain, "debug", "deps", "libbun_core.rmeta");
  const discarding = `rebuilding ${libraries}: it was not built from the current [workspace.metadata.dylint]\n`;

  // The [workspace.metadata.dylint] table, as `cargo metadata` reports it.
  const pin = (rev: string) => ({ libraries: [{ git: "https://example.invalid/mordant", rev }] });

  // The package listing is ~400 KB for this workspace and growing; spawnSync
  // stops reading at 1 MB unless told otherwise.
  const packages = Buffer.alloc(2 << 20, "x").toString();

  function pinTo(rev: string) {
    const workspace = { packages, target_directory: target, metadata: { dylint: pin(rev) } };
    writeFileSync(cargoMetadata, JSON.stringify(workspace));
  }

  function plant(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
  }

  function lines(path: string) {
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").length : 0;
  }

  async function mordant() {
    await using proc = Bun.spawn({
      cmd: [bunExe(), script],
      cwd: root,
      env: { ...bunEnv, PATH: join(root, "bin") + delimiter + bunEnv.PATH, MORDANT_TEST_DIR: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout,
      stderr,
      exitCode,
      dylintRuns: lines(join(root, "dylint-runs")),
      builtFrom: existsSync(builtFrom) ? JSON.parse(readFileSync(builtFrom, "utf8")) : undefined,
      library: existsSync(library),
      checkCache: existsSync(checkCache),
    };
  }

  // Built before the script recorded pins: nothing says which rev it came from,
  // so it goes.
  plant(library);
  plant(checkCache);
  pinTo("aaaa");
  expect(await mordant()).toEqual({
    stdout: "",
    stderr: discarding,
    exitCode: 0,
    dylintRuns: 1,
    builtFrom: pin("aaaa"),
    library: false,
    checkCache: true,
  });

  // Same pin again: what dylint built from it is left for cargo to reuse.
  plant(library);
  expect(await mordant()).toEqual({
    stdout: "",
    stderr: "",
    exitCode: 0,
    dylintRuns: 2,
    builtFrom: pin("aaaa"),
    library: true,
    checkCache: true,
  });

  // The bump. Cargo would have reused the library; the check cache stays.
  pinTo("bbbb");
  expect(await mordant()).toEqual({
    stdout: "",
    stderr: discarding,
    exitCode: 0,
    dylintRuns: 3,
    builtFrom: pin("bbbb"),
    library: false,
    checkCache: true,
  });

  // Without an answer from `cargo metadata` there is nothing to compare
  // against: the run stops there rather than guess either way.
  plant(library);
  rmSync(cargoMetadata);
  expect(await mordant()).toEqual({
    stdout: "",
    stderr: expect.stringContaining("cargo-metadata.json"),
    exitCode: 1,
    dylintRuns: 3,
    builtFrom: pin("bbbb"),
    library: true,
    checkCache: true,
  });
});
