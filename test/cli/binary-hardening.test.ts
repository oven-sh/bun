import { describe, expect, test } from "bun:test";
import { bunExe, isLinux } from "harness";
import { realpathSync } from "node:fs";

// Linux-only: asserts the ELF hardening properties that scripts/build/flags.ts
// is expected to produce. Kept in the test suite so a flag regression (e.g.
// reintroducing -z norelro, or a strip tool that drops PT_GNU_RELRO) fails CI
// rather than shipping silently. See scripts/verify-hardening.sh for the full
// audit including the controls this change does not flip (PIE/CET/JIT W^X).

async function readelf(args: string[]): Promise<string> {
  const bin = realpathSync(bunExe());
  await using proc = Bun.spawn({
    cmd: ["readelf", ...args, bin],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, exited] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(exited).toBe(0);
  return out;
}

describe.skipIf(!isLinux)("binary hardening (linux ELF)", () => {
  test("link: full RELRO", async () => {
    const seg = await readelf(["-lW"]);
    // -Wl,-z,relro: PT_GNU_RELRO segment must survive strip.
    expect(seg).toContain("GNU_RELRO");

    // -Wl,-z,now: DT_BIND_NOW or DF_1_NOW so ld.so eagerly binds and then
    // mprotects the RELRO segment read-only.
    const dyn = await readelf(["-dW"]);
    expect(dyn).toMatch(/BIND_NOW|\bNOW\b/);
  });

  test("compile: stack canaries", async () => {
    // -fstack-protector-strong on the C/C++ side pulls in __stack_chk_fail.
    const syms = await readelf(["--dyn-syms", "-W"]);
    expect(syms).toContain("__stack_chk_fail");
  });
});
