import { expect, test } from "bun:test";
import type { Config } from "../../../scripts/build/config.ts";
import { computeFlags } from "../../../scripts/build/flags.ts";

const config = (abi: "gnu" | "musl", arm64: boolean) =>
  ({
    os: "linux",
    arch: arm64 ? "aarch64" : "x64",
    linux: true,
    unix: true,
    darwin: false,
    windows: false,
    freebsd: false,
    abi,
    x64: !arm64,
    arm64,
    release: true,
    debug: false,
    asan: false,
    valgrind: false,
    fuzzilli: false,
    lto: false,
    canary: true,
    ci: true,
    buildkite: false,
    cwd: "/repo",
    buildDir: "/repo/build/release",
    ld: "/usr/bin/ld.lld",
    rustLld: undefined,
    crossTarget: undefined,
  }) as Config;

test.each([
  ["gnu", "x64", false],
  ["gnu", "aarch64", true],
  ["musl", "x64", false],
  ["musl", "aarch64", true],
] as const)("linux-%s-%s embeds the C++ runtime", (abi, _, arm64) => {
  const flags = computeFlags(config(abi, arm64)).ldflags;

  expect(flags).toContain("-static-libstdc++");
  expect(flags).toContain("-static-libgcc");
  expect(flags).not.toContain("-lstdc++");
  expect(flags).not.toContain("-lgcc");
});
