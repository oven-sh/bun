console.log(
  process.hrtime().length,
  typeof process.hrtime.bigint(),
  typeof performance.now(),
  typeof Bun.nanoseconds(),
);
