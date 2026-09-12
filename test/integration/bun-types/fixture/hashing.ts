import { expectType } from "./utilities";

Bun.hash.wyhash("asdf", 1234n);

// https://github.com/oven-sh/bun/issues/26043
// Bun.hash.crc32 accepts optional seed parameter for incremental CRC32 computation
let crc = 0;
crc = Bun.hash.crc32(new Uint8Array([1, 2, 3]), crc);
crc = Bun.hash.crc32(new Uint8Array([4, 5, 6]), crc);

// https://github.com/oven-sh/bun/issues/19573
expectType(Bun.hash.xxHash128("asdf")).is<bigint>();
expectType(Bun.hash.xxHash128(new Uint8Array([1, 2, 3]), 1234)).is<bigint>();
expectType(Bun.hash.xxHash128(new ArrayBuffer(8), 1234n)).is<bigint>();
