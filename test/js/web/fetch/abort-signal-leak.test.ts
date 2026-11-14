import { describe, expect, test } from "bun:test";
import { runAbortSignalLeakCase } from "./abortsignal-leak-fixture";

// More rounds than `maxAlive`, so leaking one signal per round still fails.
const rounds = 6;
const batchSize = 25;
const requests = rounds * batchSize;
const maxAlive = 3;

for (const http2 of [false, true]) {
  describe(http2 ? "http2" : "http/1.1", () => {
    test("req.signal with an 'abort' listener is collectable when the client aborts while the server responds", async () => {
      const result = await runAbortSignalLeakCase({ http2, mode: "abort-racing-response", rounds, batchSize });
      // The client aborts before any response byte reaches it, so every fetch() rejects. The server
      // may finish a response before it sees the abort, so abortEvents isn't asserted.
      expect(result.outcomes).toEqual({ AbortError: requests });
      expect(result.serverSignals.tracked).toBe(requests);
      expect(result.serverSignals.alive).toBeLessThanOrEqual(maxAlive);
      expect(result.clientSignals.tracked).toBe(requests);
      expect(result.clientSignals.alive).toBeLessThanOrEqual(maxAlive);
    });

    // https://github.com/oven-sh/bun/issues/4517
    test("req.signal with an 'abort' listener is collectable after the client aborts and the listener fires", async () => {
      const result = await runAbortSignalLeakCase({ http2, mode: "abort-before-response", rounds, batchSize });
      expect(result.outcomes).toEqual({ AbortError: requests });
      expect(result.abortEvents).toBe(requests);
      expect(result.serverSignals.tracked).toBe(requests);
      expect(result.serverSignals.alive).toBeLessThanOrEqual(maxAlive);
      expect(result.clientSignals.tracked).toBe(requests);
      expect(result.clientSignals.alive).toBeLessThanOrEqual(maxAlive);
    });

    test("req.signal with an 'abort' listener that never fires is collectable after the response completes", async () => {
      const result = await runAbortSignalLeakCase({ http2, mode: "response-only", rounds, batchSize });
      expect(result.outcomes).toEqual({ '200 body=""': requests });
      expect(result.abortEvents).toBe(0);
      expect(result.serverSignals.tracked).toBe(requests);
      expect(result.serverSignals.alive).toBeLessThanOrEqual(maxAlive);
      expect(result.clientSignals).toEqual({ tracked: 0, alive: 0 });
    });
  });
}
