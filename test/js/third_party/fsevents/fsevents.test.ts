import { bunEnv, bunExe } from "harness";
import path from "path";
import fs from "fs";
import os from "os";

test("fsevents works (napi_ref_threadsafe_function keeps event loop alive)", async () => {
  const tempFile = fs.mkdtempSync(path.join(os.tmpdir(), "fsevents-test-"));
  const spawned = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "fsevents-event-loop.mjs"), tempFile],
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  await Bun.sleep(50);
  if (spawned.killed) {
    throw new Error("event loop died, test failed");
  }
  await Bun.write(tempFile + "/hello.txt", "test");
  expect(await spawned.exited).toBe(0);
  expect(await new Response(spawned.stdout).text()).toBe("it works!\n");
});
