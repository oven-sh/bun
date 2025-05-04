import { bunExe } from "harness";

async function read(stream: ReadableStream<Uint8Array>): Promise<string | undefined> {
  const reader = stream.getReader();
  const res = await reader.read();
  reader.releaseLock();
  if (res.done) return undefined;
  return new TextDecoder().decode(res.value);
}

test("unref should exit", async () => {
  const child = Bun.spawn({
    cmd: [bunExe(), import.meta.dir + "/unref_should_exit.js"],
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdin.write("one\n");
  expect(await read(child.stdout)).toEqual('got 1 "one\\n"\n');
  child.stdin.write("two\n");
  expect(await read(child.stdout)).toEqual('got 2 "two\\n"\n');
  await child.exited;
  expect(await read(child.stdout)).toBeUndefined();
  expect(await read(child.stderr)).toBeUndefined();
  expect(child.exitCode).toBe(0);
});
