/**
 * `PendingWrites` (src/runtime/socket/pending_writes.rs) holds the bytes of a
 * node:net write that a send did not take. It has no JS surface of its own, so
 * `pendingWritesReplayProbe` replays a schedule on a fresh queue: an entry
 * `n >= 0` appends `n` bytes, an entry `n < 0` sends up to `-n` bytes from the
 * front and drains `-n`. Unsent bytes that change address count as moved.
 *
 * test/js/node/net/net-syscall-fault.test.ts drives the same queue through a
 * socket, in builds that can clamp a send.
 */
import { pendingWritesReplayProbe as probe } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

const step = 4096;
const tail = 255 * step;

describe("the queue of unsent node:net bytes", () => {
  // Moving the unsent bytes to the front after every partial send cost
  // tail * tail / (2 * step) bytes: 132,648,960 for the first row.
  test.each([
    [tail, step],
    [2 * tail, step],
    [1023 * 1024, 1024],
  ])("a drain of %i bytes in %i-byte steps moves no bytes and frees the allocation", (bytes, step) => {
    expect(probe([bytes, ...new Array(bytes / step).fill(-step)])).toEqual({
      intact: true,
      sent: bytes,
      unsent: 0,
      movesOnDrain: 0,
      movesOnAppend: 0,
      bytesMoved: 0,
      capacity: 0,
      peakCapacity: bytes,
    });
  });

  // One writev sends the queue and the chunk behind it, so the count it
  // reports can be larger than the queue.
  test("a drain count past the end empties the queue", () => {
    expect(probe([1000, -3000, 5000, -100, -4900])).toEqual({
      intact: true,
      sent: 6000,
      unsent: 0,
      movesOnDrain: 0,
      movesOnAppend: 0,
      bytesMoved: 0,
      capacity: 0,
      peakCapacity: 5000,
    });
    expect(probe([1000, -999])).toEqual({
      intact: true,
      sent: 999,
      unsent: 1,
      movesOnDrain: 0,
      movesOnAppend: 0,
      bytesMoved: 0,
      capacity: 1000,
      peakCapacity: 1000,
    });
  });

  // An append drops the sent prefix once it is at least as large as the unsent
  // bytes. So an append moves at most the bytes sent since the move before.
  test("an empty write behind a tail moves the unsent bytes once per halving", () => {
    const schedule = [tail];
    for (let i = 0; i < tail / step; i++) schedule.push(0, -step);
    expect(probe(schedule)).toEqual({
      intact: true,
      sent: tail,
      unsent: 0,
      movesOnDrain: 0,
      movesOnAppend: 7,
      bytesMoved: (127 + 63 + 31 + 15 + 7 + 3 + 1) * step,
      capacity: 0,
      peakCapacity: tail,
    });
  });

  test("writes behind a tail that is half sent fit in its allocation", () => {
    const schedule = [tail, ...new Array(128).fill(-step)];
    for (let i = 0; i < 400; i++) schedule.push(1024, -step);
    expect(probe(schedule)).toEqual({
      intact: true,
      sent: tail + 400 * 1024,
      unsent: 0,
      movesOnDrain: 0,
      movesOnAppend: 10,
      bytesMoved: (508 + 289 + 163 + 91 + 52 + 28 + 16 + 7 + 4 + 1) * 1024,
      capacity: 0,
      peakCapacity: tail,
    });
  });

  // Whether the bytes move when the allocation grows is the allocator's choice.
  test("a write behind a tail that is less than half sent doubles the allocation", () => {
    const { movesOnAppend, bytesMoved, ...result } = probe([tail, ...new Array(127).fill(-step), 1024]);
    expect(result).toEqual({
      intact: true,
      sent: 127 * step,
      unsent: 128 * step + 1024,
      movesOnDrain: 0,
      capacity: 2 * tail,
      peakCapacity: 2 * tail,
    });
    expect([0, 128 * step]).toContain(bytesMoved);
    expect(movesOnAppend).toBe(bytesMoved === 0 ? 0 : 1);
  });
});
