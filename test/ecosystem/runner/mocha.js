export async function run(path) {
  const jest = Bun.jest(path);
  for (const [key, value] of Object.entries(jest)) {
    globalThis[key] = value;
  }
  globalThis.before = jest.beforeAll;
  globalThis.after = jest.afterAll;
  await import(path);
}
