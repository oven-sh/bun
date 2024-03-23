import { TCPSocketListener } from "bun";
import { sleep, listen } from "bun";
import { describe, expect, it } from "bun:test";

describe("an https fetch to a silent TCP socket", () => {
  let were_done: (listener: TCPSocketListener) => void;
  async function do_shutdown() {
    const listener: TCPSocketListener = await new Promise(res => were_done = res);
    listener.stop(true);
    console.log("listener is ded");
  }
  do_shutdown();
  it("should respond to abort signals", async () => {
    const listener = listen({
      port: 0,
      hostname: "localhost",
      socket: {
        data() {},
      },
    });
    try {
      const signal = AbortSignal.timeout(1);
      const check_after = sleep(200);

      // After 1ms, the signal should abort the fetch and reject its promise. (with an http URL, this behaviour is seen)
      // As of this commit, however, the fetch will hang indefinitely.
      // We detect this by requiring the rejection after waiting 250ms.
      expect(() =>
        Promise.race([check_after, fetch(`https://127.0.0.1:${listener.port}`, { signal: signal })]),
      ).toThrow(new DOMException("The operation timed out."));
      await check_after;
    } finally {
      were_done(listener);
    }
  });
});
