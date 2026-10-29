import { expectType } from "./utilities";

Bun.hash.wyhash("asdf", 1234n);

// https://github.com/oven-sh/bun/issues/26043
// Bun.hash.crc32 accepts optional seed parameter for incremental CRC32 computation
let crc = 0;
crc = Bun.hash.crc32(new Uint8Array([1, 2, 3]), crc);
crc = Bun.hash.crc32(new Uint8Array([4, 5, 6]), crc);

// Bun.CryptoHasher.hash: nothing, an encoding, a TypedArray to write into, or options of hash() in node:crypto
expectType(Bun.CryptoHasher.hash("sha256", "abc")).is<Buffer>();
expectType(Bun.CryptoHasher.hash("sha256", "abc", "hex")).is<string>();
expectType(Bun.CryptoHasher.hash("sha256", "abc", new Uint8Array(32))).is<NodeJS.TypedArray>();
expectType(Bun.CryptoHasher.hash("sha256", "abc", {})).is<string>();
expectType(Bun.CryptoHasher.hash("shake256", "abc", { outputLength: 8 })).is<string>();
expectType(Bun.CryptoHasher.hash("sha256", "abc", { outputEncoding: null })).is<string>();
expectType(Bun.CryptoHasher.hash("sha256", "abc", { outputEncoding: "buffer" })).is<Buffer>();
declare const hashOptions: Bun.CryptoHasherHashOptions;
expectType(Bun.CryptoHasher.hash("sha256", "abc", hashOptions)).is<string | Buffer>();
class HasherSubclass extends Bun.CryptoHasher {}
expectType(HasherSubclass.hash("shake128", "abc", { outputLength: 8, outputEncoding: "buffer" })).is<Buffer>();
// @ts-expect-error
Bun.CryptoHasher.hash("sha256", "abc", { encoding: "hex" });
// @ts-expect-error
Bun.CryptoHasher.hash("sha256", "abc", "hexx");
// `Parameters`, `ReturnType` and `bind` read the last overload, which is the one with an encoding.
expectType<ReturnType<typeof Bun.CryptoHasher.hash>>().is<string>();
expectType<Parameters<typeof Bun.CryptoHasher.hash>[2]>().is<Bun.DigestEncoding>();
expectType(Bun.CryptoHasher.hash.bind(Bun.CryptoHasher, "sha256")("abc", "hex")).is<string>();
