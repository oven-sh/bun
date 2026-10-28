// Eight Workers and the main thread work on one SharedArrayBuffer: adds, a lock made of compareExchange, wait and notify in turns, waitAsync, a growable buffer.
type Job = { kind: string; memory: SharedArrayBuffer; id: number; rounds: number };
function addMany(cells: Int32Array, rounds: number): void {
  for (let i = 0; i < rounds; i++) Atomics.add(cells, 0, 1);
}
function underLock(cells: Int32Array, rounds: number): void {
  for (let i = 0; i < rounds; i++) {
    while (Atomics.compareExchange(cells, 1, 0, 1) !== 0) Atomics.wait(cells, 1, 1, 1);
    cells[2] = cells[2] + 1;
    Atomics.store(cells, 1, 0);
    Atomics.notify(cells, 1, 1);
  }
}
function inTurns(cells: Int32Array, mine: number, players: number, rounds: number): void {
  for (let i = 0; i < rounds; i++) {
    for (;;) {
      const turn = Atomics.load(cells, 3);
      if (turn % players === mine) break;
      Atomics.wait(cells, 3, turn);
    }
    cells[4] = (cells[4] * 31 + mine) | 0;
    Atomics.add(cells, 3, 1);
    Atomics.notify(cells, 3);
  }
}

if (Bun.isMainThread) {
  const memory = new SharedArrayBuffer(1024);
  const cells = new Int32Array(memory);
  const workers = Array.from({ length: 8 }, () => new Worker(new URL(import.meta.url)));
  const all = (kind: string, rounds: number) =>
    Promise.all(workers.map((worker, id) => new Promise<string>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage({ kind, memory, id, rounds } satisfies Job);
    })));
  await all("add", 20_000);
  console.log("added:", cells[0]);
  await all("lock", 2_000);
  console.log("under the lock:", cells[2]);
  await all("turns", 200);
  console.log("in turns:", cells[3], cells[4]);

  const waiting = Atomics.waitAsync(cells, 5, 0);
  console.log("waitAsync:", waiting.async);
  workers[0].postMessage({ kind: "wake", memory, id: 0, rounds: 0 } satisfies Job);
  console.log("woken:", await waiting.value, cells[5]);
  console.log("not equal:", Atomics.waitAsync(cells, 5, 0).value, "timed out:", await Atomics.waitAsync(cells, 6, 0, 5).value);

  const wide = new BigInt64Array(memory, 512, 4);
  await all("wide", 10_000);
  console.log("64 bits:", wide[0], Atomics.load(wide, 1));

  const growable = new SharedArrayBuffer(16, { maxByteLength: 4096 });
  const follows = new Int32Array(growable);
  const grown = new Promise<string>(resolve => (workers[1].onmessage = event => resolve(event.data)));
  workers[1].postMessage({ kind: "grow", memory: growable, id: 1, rounds: 0 } satisfies Job);
  console.log("grown there:", await grown, "seen here:", growable.byteLength, follows.length, follows[255]);

  const bytes = new Uint8Array(memory, 256, 64), floats = new Float64Array(memory, 320, 4);
  await all("plain", 0);
  console.log("plain stores:", [...bytes.slice(0, 8)].join(), [...floats].join());
  for (const worker of workers) worker.terminate();
} else {
  addEventListener("message", (event: MessageEvent<Job>) => {
    const { kind, memory, id, rounds } = event.data;
    const cells = new Int32Array(memory);
    if (kind === "add") addMany(cells, rounds);
    else if (kind === "lock") underLock(cells, rounds);
    else if (kind === "turns") inTurns(cells, id, 8, rounds);
    else if (kind === "wake") return void (Atomics.store(cells, 5, 7), Atomics.notify(cells, 5));
    else if (kind === "wide") {
      const wide = new BigInt64Array(memory, 512, 4);
      for (let i = 0; i < rounds; i++) Atomics.add(wide, 0, 2n ** 32n), Atomics.or(wide, 1, 1n << BigInt(id * 8));
    } else if (kind === "grow") {
      memory.grow(1024);
      cells[255] = 99;
      return postMessage(memory.byteLength + " " + cells.length);
    } else if (kind === "plain") {
      new Uint8Array(memory, 256, 64)[id] = id + 1;
      if (id < 4) new Float64Array(memory, 320, 4)[id] = id + 0.25;
    }
    postMessage("done");
  });
}
