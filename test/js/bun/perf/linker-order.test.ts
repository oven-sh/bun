import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { generateOrderFile } from "../../../../scripts/orderfile/generate.ts";
import { linkDepends, linkerFlags, orderFilePath, usesOrderFile } from "../../../../scripts/build/flags.ts";
import type { Config } from "../../../../scripts/build/config.ts";

/**
 * `<buildDir>/linker.order` is the lld `--symbol-ordering-file` for the linux
 * release link: it lists the functions bun executes while starting up so they
 * land together at the front of `.text`, which is worth ~12 MB of resident
 * binary pages on a `bun -e 'console.log(1)'` (see scripts/orderfile/generate.ts).
 *
 * Nothing in the build fails if this wiring rots. lld skips names it cannot
 * resolve, and we pass --no-warn-symbol-ordering, so a dropped flag silently
 * gives the RSS back instead of breaking the link. CI's verifyOrderFileApplied()
 * catches it, but only on release builds — these checks are what notices in a PR.
 */
const cfg = (overrides: Partial<Config> = {}) =>
  ({
    linux: true,
    release: true,
    asan: false,
    valgrind: false,
    darwin: false,
    windows: false,
    freebsd: false,
    buildDir: "/tmp/build",
    cwd: "/repo",
    ...overrides,
  }) as Config;

describe("symbol ordering file", () => {
  it("is enabled for the linux release link", () => {
    expect(usesOrderFile(cfg())).toBe(true);
  });

  it("is disabled where it cannot work or is not wanted", () => {
    expect(usesOrderFile(cfg({ linux: false }))).toBe(false); // ELF only
    expect(usesOrderFile(cfg({ release: false }))).toBe(false); // debug: not worth a relink
    expect(usesOrderFile(cfg({ asan: true }))).toBe(false); // tracer mprotects .text
    expect(usesOrderFile(cfg({ valgrind: true }))).toBe(false);
  });

  it("lives in the build directory, never the source tree", () => {
    // A committed order file rots silently. It is a build artifact.
    expect(orderFilePath(cfg())).toBe(join("/tmp/build", "linker.order"));
  });

  it("is passed to lld on the linux release link", () => {
    const config = cfg();
    const applied = linkerFlags
      .filter(flag => flag.when(config))
      .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
      .flat();

    expect(applied).toContain(`-Wl,--symbol-ordering-file=${orderFilePath(config)}`);
    // Without this, a stale entry is a hard link error rather than a skipped symbol.
    expect(applied).toContain("-Wl,--no-warn-symbol-ordering");
  });

  it("is not passed on a debug or sanitizer link", () => {
    for (const config of [cfg({ release: false }), cfg({ asan: true })]) {
      const applied = linkerFlags
        .filter(flag => flag.when(config))
        .flatMap(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag))
        .flat()
        .join(" ");
      expect(applied).not.toContain("--symbol-ordering-file");
    }
  });

  it("is a link dependency, so regenerating it relinks", () => {
    // This is what makes the release two-pass work: overwrite the file, re-run
    // ninja, and the link is the only edge whose input changed.
    expect(linkDepends(cfg())).toContain(orderFilePath(cfg()));
    expect(linkDepends(cfg({ release: false }))).not.toContain(orderFilePath(cfg({ release: false })));
  });
});

describe("order file generator", () => {
  it.skipIf(process.platform !== "linux")("refuses a build directory with no binary to trace", () => {
    expect(() => generateOrderFile({ buildDir: "/tmp/definitely-not-a-build-dir" })).toThrow(/not found/);
  });

  it.skipIf(process.platform === "linux")("refuses to run off linux", () => {
    // It is an ELF linker input and the tracer reads /proc/self/maps.
    expect(() => generateOrderFile({ buildDir: "/tmp/build" })).toThrow(/linux/);
  });
});
