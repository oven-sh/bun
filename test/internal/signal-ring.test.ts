/**
 * `SignalRing` (src/threading/signal_ring.rs) queues signal numbers from
 * POSIX signal handlers for the event loop (`PosixSignalHandle`). The kernel
 * runs the handler of a process-directed signal on any thread that does not
 * block it, so two handlers can run `enqueue` at once. A ring that assumes one
 * producer then stores a stale `tail` behind `head`, and `dequeue` hands out the
 * 0 left in consumed slots; `Bun__onSignalForJS(0)` finds no signal name for
 * it and crashes.
 *
 * Which thread runs a handler is the kernel's choice, so a test cannot line up
 * two handlers on purpose. `signalRingProbe` (src/runtime/signal_ring_testing.rs,
 * `bun:internal-for-testing`) runs the ring's contract with plain threads
 * instead: N producers enqueue while the JS thread dequeues. The crate's own
 * `#[cfg(test)]` tests cover the same contract under Miri.
 */
import { signalRingProbe } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("every signal the ring accepts from 8 concurrent producers comes out once, never as 0", () => {
  const producers = 8;
  const perProducer = 50_000;
  expect(signalRingProbe(producers, perProducer)).toEqual({
    accepted: Array(producers).fill(perProducer),
    dequeued: Array(producers).fill(perProducer),
    zeros: 0,
    unknown: 0,
  });
});
