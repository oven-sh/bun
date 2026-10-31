// Reloads the same file under a fresh specifier each time: https://github.com/oven-sh/bun/issues/9521
// text-loader.test.ts passes the count.
const count = Number(process.argv[2] ?? 5_000);
for (let i = 0; i < count; i++) {
  await import("./text-loader-fixture-text-file.txt?" + i);
}
Bun.gc(true);

const { default: text } = await import("./text-loader-fixture-text-file.txt");

console.write(text);
