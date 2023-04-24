import { sleep, listen } from "bun";
import { describe, expect, it } from "bun:test";

describe("an https fetch to a silent TCP socket", () => {
  const listener = listen({
    port: 0,
    hostname: "localhost",
    socket: {
      data() {},
    },
  });
  it("should respond to abort signals", async () => {
    const signal = AbortSignal.timeout(1);

    // After 1ms, the signal should abort the fetch and reject its promise. (with an http URL, this behaviour is seen)
    // As of this commit, however, the fetch will hang indefinitely.
    // We detect this by requiring the rejection after waiting 250ms.
    expect(() =>
      Promise.race([
        sleep(250),
        fetch(`https://127.0.0.1:${listener.port}`, { signal: signal }).then(res => res.text()),
      ]),
    ).toThrow(new DOMException("The operation timed out."));
  });
});
