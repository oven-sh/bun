// Isolated linker duplicated packages caught in a peer-dependency cycle.
//
// When package A peers B and B peers A, the first-pass peer resolution used
// to add each package to its own transitive-peer set (via the other side of
// the cycle). That changed the peer hash for the instance reached through
// the cycle vs. the instance not reached through it, so the same
// `name@version` landed under two different `.bun/` keys. At runtime each
// physical copy owns its own class identities, breaking `instanceof`.
//
// Fix: when marking visited parents with a resolved transitive peer, skip
// any node whose own pkg_id equals the resolved peer's pkg_id — a package
// is never its own peer.
//
// https://github.com/oven-sh/bun/issues/29343

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("isolated linker deduplicates packages joined by a peer-dep cycle", async () => {
  // Two packages with mutual peer dependencies, both installed directly by
  // the root. file: deps exercise the same store-key path as npm deps (the
  // hoisting + peer-resolution logic is the same). Before the fix each
  // package installed twice under `.bun/` with distinct +hex peer-hash
  // suffixes; after the fix there is exactly one of each.
  using dir = tempDir("isolated-peer-cycle", {
    "app/package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: {
        "pa": "file:../pa",
        "pb": "file:../pb",
      },
    }),
    "app/bunfig.toml": `[install]\nlinker = "isolated"\n`,
    "pa/package.json": JSON.stringify({
      name: "pa",
      version: "1.0.0",
      peerDependencies: { "pb": "*" },
    }),
    "pb/package.json": JSON.stringify({
      name: "pb",
      version: "1.0.0",
      peerDependencies: { "pa": "*" },
    }),
  });
  const cwd = join(String(dir), "app");

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Group `.bun/` entries by name@version, stripping the +hex peer-hash
  // suffix. Any name@version appearing more than once means the linker
  // failed to collapse a cyclic peer resolution onto a single entry.
  const storeEntries = readdirSync(join(cwd, "node_modules/.bun")).filter(
    e => !e.startsWith(".") && e !== "node_modules",
  );
  const byNameVersion = new Map<string, string[]>();
  for (const entry of storeEntries) {
    const nameVersion = entry.replace(/\+[a-f0-9]{16}$/, "");
    const list = byNameVersion.get(nameVersion) ?? [];
    list.push(entry);
    byNameVersion.set(nameVersion, list);
  }
  const duplicates = [...byNameVersion].filter(([, copies]) => copies.length > 1);
  expect(duplicates).toEqual([]);
});
