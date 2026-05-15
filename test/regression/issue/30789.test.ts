// https://github.com/oven-sh/bun/issues/30789
//
// `bun update --latest` with ANSI enabled uses UTF-8 arrows (`↑`, `→`) in its
// summary template. The Rust port's `substitute_template` walked the template
// byte-by-byte and re-encoded each byte as Latin-1, turning `↑` (E2 86 91)
// into the three-char mojibake `â` (C3 A2, C2 86, C2 91).
//
// This test stands up its own in-process npm registry (so it doesn't depend
// on Verdaccio or the shared `dummy.registry.ts` state), installs an older
// version of a fixture package, then runs `bun update --latest` under
// `FORCE_COLOR=1` and asserts the arrow line renders as valid UTF-8.

import { file, spawn } from "bun";
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { bunEnv, bunExe, tempDir } from "harness";

const FIXTURES = join(import.meta.dir, "..", "..", "cli", "install");
const PKG = "baz";
const OLD = "0.0.3";
const NEW = "0.0.5";

test("`update --latest` renders unicode arrows (not mojibake)", async () => {
  // Tiny in-memory npm registry. Serves the package manifest for `baz` with
  // two versions (OLD, NEW; latest = NEW) and streams the two matching
  // tarballs from the install test fixtures.
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = req.url.replaceAll("%2f", "/");
      if (url.endsWith(".tgz")) {
        const name = basename(url).toLowerCase();
        return new Response(file(join(FIXTURES, name)));
      }
      const root = `http://localhost:${server.port}`;
      return new Response(
        JSON.stringify({
          name: PKG,
          versions: {
            [OLD]: { name: PKG, version: OLD, dist: { tarball: `${root}/${PKG}-${OLD}.tgz` } },
            [NEW]: { name: PKG, version: NEW, dist: { tarball: `${root}/${PKG}-${NEW}.tgz` } },
          },
          "dist-tags": { latest: NEW },
        }),
      );
    },
  });

  using dir = tempDir("update-arrows-30789", {
    "package.json": JSON.stringify({
      name: "repro",
      dependencies: { [PKG]: OLD },
    }),
  });

  // Point the install at our in-process registry; disable the on-disk
  // manifest cache so version resolution always goes through us.
  writeFileSync(
    join(String(dir), "bunfig.toml"),
    `[install]
cache = false
registry = "http://localhost:${server.port}/"
`,
  );

  // Install the old version first.
  {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--linker=hoisted"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);
  }

  // Now run `update --latest` with ANSI forced on so the colored template
  // (which contains the `↑` and `→` arrows) is used.
  await using proc = spawn({
    cmd: [bunExe(), "update", "--latest"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...bunEnv, FORCE_COLOR: "1" },
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  // The up-arrow (U+2191, `E2 86 91`) and right-arrow (U+2192, `E2 86 92`)
  // must appear as their valid multi-byte UTF-8 sequences.
  expect(out).toContain("↑");
  expect(out).toContain("→");

  // The Latin-1-per-byte mojibake (`â` = C3 A2) from the regression must
  // not appear anywhere in the output.
  expect(out).not.toContain("â");

  // The full arrow line (with ANSI stripped) should round-trip cleanly.
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  expect(stripAnsi(out)).toContain(`↑ ${PKG} ${OLD} → ${NEW}`);
});
