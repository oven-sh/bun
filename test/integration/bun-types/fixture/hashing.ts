Bun.hash.wyhash("asdf", 1234n);

// crc32 with optional seed parameter for incremental hashing
let crc = 0;
crc = Bun.hash.crc32(new Uint8Array([1, 2, 3]), crc);
crc = Bun.hash.crc32(new Uint8Array([4, 5, 6]), crc);
Bun.hash.crc32("test string", 12345);
