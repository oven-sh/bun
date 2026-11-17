import { test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { compareSwitches } from "./brotli-timing";

test.skipIf(isASAN || isDebug)(
  "time over time with a switch",
  () =>
    compareSwitches(
      [11],
      [
        [256, 8, 4],
        [1024, 4, 4],
        [4096, 2, 4],
        [16384, 1, 3],
        [65536, 1, 2],
      ],
      {
        same: 0,
        FS_RUST: 0x1,
        FS_128: 0x2,
        EC_RUST: 0x4,
        EC_128: 0x8,
        EC_RUST_SMALL: 0x10,
        NO_LITTLE: 0x40,
        EC_INTEGER: 0x80,
        RP_RUST: 0x100,
        RP_128: 0x200,
        RP_BY_FOUR: 0x400,
        RP_COLUMNS: 0x800,
        S5_RUST: 0x100000,
        S5_MERGED: 0x200000,
        TM_RUST: 0x400000,
        PB_RUST: 0x1000000,
        TL_RUST: 0x2000000,
        ALL_RUST: 0x521105,
      },
    ),
  170_000,
);
