export async function run(path) {
  for (const [key, value] of Object.entries(Bun.jest(path))) {
    globalThis[key] = value;
  }
  await import(path);
}
