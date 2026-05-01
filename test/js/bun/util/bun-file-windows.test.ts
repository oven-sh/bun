import { closeSync, openSync } from "fs";
import { open } from "fs/promises";

test('Bun.file("/dev/null") works on windows', async () => {
  expect(await Bun.file("/dev/null").arrayBuffer()).toHaveLength(0);
});

test('openSync("/dev/null") works on windows', async () => {
  const handle = openSync("/dev/null", "r");
  closeSync(handle);
});

test('open("/dev/null") works on windows', async () => {
  const handle = await open("/dev/null", "r");
  await handle.close();
});
