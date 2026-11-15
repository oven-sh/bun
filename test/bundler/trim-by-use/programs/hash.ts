console.log(
  Bun.hash("bun"),
  Bun.hash.crc32("bun"),
  Bun.hash.adler32("bun"),
  Bun.hash.cityHash32("bun"),
  Bun.hash.xxHash32("bun"),
  Bun.hash.murmur32v3("bun"),
  Bun.hash.wyhash("bun", 1n),
  Bun.hash.rapidhash("bun"),
);
