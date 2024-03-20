for (let i = 0; i < 100000; i++) {
  await import("./text-loader-fixture-text-file.txt?" + i++);
}

const { default: text } = await import("./text-loader-fixture-text-file.txt");

console.write(text);
