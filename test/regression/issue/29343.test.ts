// https://github.com/oven-sh/bun/issues/29343

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("isolated linker deduplicates packages joined by a peer-dep cycle", async () => {
  // file: deps exercise the same store-key path as npm deps; the peer
  // resolution and hashing logic is identical.
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
  // Drain stdout too, otherwise a large install summary could fill the pipe
  // buffer and deadlock the child.
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  // Group `.bun/` entries by name@version, stripping the +hex peer-hash suffix.
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

  // Each cycle participant must appear exactly once. Asserting the count
  // (rather than just "no duplicates") also fails if the fix regressed into
  // dropping a package entirely.
  const countFor = (name: string) => storeEntries.filter(e => e.startsWith(`${name}@`)).length;
  expect({ pa: countFor("pa"), pb: countFor("pb") }).toEqual({ pa: 1, pb: 1 });

  // And no same-version package may appear under more than one store key.
  const duplicates = [...byNameVersion].filter(([, copies]) => copies.length > 1);
  expect(duplicates).toEqual([]);
});
