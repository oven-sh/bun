const count = process.platform === "win32" ? 10_000 : 100_000;
for (let i = 0; i < count; i++) {
  await import("./text-loader-fixture-text-file.txt?" + i++);
}

const { default: text } = await import("./text-loader-fixture-text-file.txt");

console.write(text);
