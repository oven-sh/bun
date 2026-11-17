import { test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { compareSwitches } from "./brotli-timing";

test.skipIf(isASAN || isDebug)(
  "time over time with a switch",
  async () => {
    const small = [
      [128, 1400, 4],
      [512, 360, 4],
      [2048, 90, 4],
      [8192, 22, 4],
    ];
    await compareSwitches([0, 1], small, { same: 0, SL_RUST: 1, SL_SHELL_ONLY: 0x80, SL_MAX_32: 0x100 });
    await compareSwitches([2, 5], small, { same: 0, SL_RUST: 1, SL_SHELL_ONLY: 0x80, SL_MAX_32: 0x100 });
    const sizes = [
      [256, 24, 3],
      [1024, 8, 3],
      [4096, 3, 3],
      [16384, 1, 3],
    ];
    await compareSwitches([10, 11], sizes, {
      same: 0,
      LITTLE_ALWAYS: 0x8,
      EC_RUST_SMALL: 0x10,
      EC_BOTH: 0x18,
      EC_SINGLE: 0x20,
      SL_RUST: 1,
    });
  },
  170_000,
);
