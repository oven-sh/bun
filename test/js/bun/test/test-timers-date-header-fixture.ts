import { jest, test } from "bun:test";

test("runAllTimers returns with a keep-alive connection open and no user timers", async () => {
  using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("hi") });

  jest.useFakeTimers();
  try {
    // Accepting the connection arms Bun.serve's internal 1s Date header timer,
    // and the keep-alive connection makes it re-arm itself every time it fires.
    // Before oven-sh/bun#37946 it was enrolled in the fake heap, so runAllTimers()
    // popped it, it re-armed at mocked now + 1s, and the drain never ended.
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    await res.text();

    jest.runAllTimers();
  } finally {
    jest.useRealTimers();
  }
  console.log("RUN_ALL_OK");
});
