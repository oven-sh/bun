import { describe, expect, test } from "bun:test";
import { runAbortSignalLeakCase } from "./abortsignal-leak-fixture";

// A leak keeps every signal it affects, so a few rounds show it as clearly as
// fifty did. More rounds than `maxAlive` means a leak of one signal per round
// still fails.
const rounds = 6;
const batchSize = 25;
const requests = rounds * batchSize;
// The count after a full GC is 0 in practice. The bound leaves room for a
// straggler without accepting a leak: a leak retains one signal per request,
// or at least one per round, both well above this.
const maxAlive = 3;

for (const http2 of [false, true]) {
  describe(http2 ? "http2" : "http/1.1", () => {
    test("req.signal with an 'abort' listener is collectable when the client aborts while the server responds", async () => {
      const result = await runAbortSignalLeakCase({ http2, mode: "abort-racing-response", rounds, batchSize });
      // The client aborts before any response byte can reach it, so every
      // fetch() rejects. Whether the server sees the abort or finishes the
      // response first differs per request, so abortEvents is not asserted.
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
