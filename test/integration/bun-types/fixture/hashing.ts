import { expectType } from "./utilities";

Bun.hash.wyhash("asdf", 1234n);

// https://github.com/oven-sh/bun/issues/26043
// Bun.hash.crc32 accepts optional seed parameter for incremental CRC32 computation
let crc = 0;
crc = Bun.hash.crc32(new Uint8Array([1, 2, 3]), crc);
crc = Bun.hash.crc32(new Uint8Array([4, 5, 6]), crc);

// The calls that docs/runtime/hashing.mdx prints. Every seeded hash takes its seed as a number or a bigint.
expectType(Bun.hash("data", 1234)).is<bigint>();
expectType(Bun.hash.wyhash("data", 1234)).is<bigint>();
expectType(Bun.hash.crc32("data", 1234)).is<number>();
expectType(Bun.hash.adler32("data")).is<number>();
expectType(Bun.hash.cityHash32("data")).is<number>();
expectType(Bun.hash.cityHash64("data", 1234)).is<bigint>();
expectType(Bun.hash.xxHash32("data", 1234)).is<number>();
expectType(Bun.hash.xxHash64("data", 1234)).is<bigint>();
expectType(Bun.hash.xxHash3("data", 1234)).is<bigint>();
expectType(Bun.hash.murmur32v3("data", 1234)).is<number>();
expectType(Bun.hash.murmur32v2("data", 1234)).is<number>();
expectType(Bun.hash.murmur64v2("data", 1234)).is<bigint>();
expectType(Bun.hash.rapidhash("data", 1234)).is<bigint>();

expectType(Bun.hash.crc32("data", 1234n)).is<number>();
expectType(Bun.hash.cityHash64("data", 1234n)).is<bigint>();
expectType(Bun.hash.xxHash32("data", 1234n)).is<number>();
expectType(Bun.hash.xxHash64("data", 1234n)).is<bigint>();
expectType(Bun.hash.xxHash3("data", 1234n)).is<bigint>();
expectType(Bun.hash.murmur32v3("data", 1234n)).is<number>();
expectType(Bun.hash.murmur32v2("data", 1234n)).is<number>();
expectType(Bun.hash.murmur64v2("data", 1234n)).is<bigint>();
expectType(Bun.hash.rapidhash("data", 1234n)).is<bigint>();

// adler32 and cityHash32 have no seed.
// @ts-expect-error
Bun.hash.adler32("data", 1234);
// @ts-expect-error
Bun.hash.cityHash32("data", 1234);
