import { basename } from "node:path";

export async function run(path) {
  const { test, expect } = Bun.jest(path);

  test(basename(path), async () => {
    expect(import(path)).resolves.not.toThrow();
  });
}
