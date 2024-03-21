const count = process.platform === "win32" ? 1000 : 10_000;
for (let i = 0; i < count; i++) {
  await import("./text-loader-fixture-text-file.txt?" + i++);
}
Bun.gc(true);

const { default: text } = await import("./text-loader-fixture-text-file.txt");

console.write(text);
