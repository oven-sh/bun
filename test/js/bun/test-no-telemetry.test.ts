import { expect, test } from "bun:test";

test("server without telemetry", async () => {
  // Don't configure telemetry at all
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/test`);
  expect(await response.text()).toBe("test");

  // Small delay to match the telemetry test
  await Bun.sleep(10);
});
