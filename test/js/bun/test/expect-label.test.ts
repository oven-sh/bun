import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import stripAnsiColors from "strip-ansi";

test("expect-label", () => {
  let err;
  try {
    expect("a", "lol!").toBe("b");
    expect.unreachable();
  } catch (e) {
    err = e;
  }

  expect(stripAnsiColors(err.message)).toContain("lol!\n\nExpected");
  expect(stripAnsiColors(err.message)).not.toContain("to be");
  expect(stripAnsiColors(err.message)).not.toContain("toBe");
});

test("expect-label toEqual", () => {
  let err;
  try {
    expect("a", "lol!").toEqual("b");
    expect.unreachable();
  } catch (e) {
    err = e;
  }

  expect(stripAnsiColors(err.message)).toContain("lol!\n\nExpected");
});

test("non-strings do not crash", () => {
  try {
    expect("a", undefined).toEqual("b");
  } catch {}
  try {
    // @ts-ignore
    expect("a", Symbol("a")).toEqual("b");
  } catch {}
  try {
    // @ts-ignore
    expect("a", null).toEqual("b");
  } catch {}
});

test("expect(value, label) does not leak the label", async () => {
  const code = /* js */ `
    const { expect } = require("bun:test");
    const base = Buffer.alloc(256 * 1024, "a").toString();
    for (let i = 0; i < 20; i++) expect(1, base + i).toBe(1);
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < 300; i++) expect(1, base + i).toBe(1);
    Bun.gc(true);
    console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - before) / 1024 / 1024 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: {
      ...bunEnv,
      // ASAN's quarantine pins freed blocks and keeps RSS at peak.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim());
  // Unfixed: ~76 MiB. Fixed: allocator slack only.
  expect(deltaMiB).toBeLessThan(isASAN || isDebug ? 60 : 40);
  expect(exitCode).toBe(0);
});
