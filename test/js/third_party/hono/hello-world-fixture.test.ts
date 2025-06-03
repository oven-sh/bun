import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("Hono app export bug", async () => {
  await using process = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "hello-world.fixture.ts")],
    env: {
      ...bunEnv,
      "BUN_PORT": "0",
    },
    stdout: "pipe",
    stderr: "inherit",
  });

  // Wait for server to start and get its URL
  const reader = process.stdout.getReader();
  let serverUrl = "";
  while (!serverUrl && !process.exitCode) {
    const { value, done } = await reader.read();
    if (done) break;
    const output = new TextDecoder().decode(value);
    const match = output.match(/http:\/\/[^:]+:(\d+)/);
    if (match) {
      serverUrl = match[0];
      break;
    }
  }

  expect(serverUrl).toBeTruthy();

  // Make a request to verify the server works
  const response = await fetch(serverUrl);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('The message is "Hono is cool!"');

  // Kill the server process
  process.kill();
});
