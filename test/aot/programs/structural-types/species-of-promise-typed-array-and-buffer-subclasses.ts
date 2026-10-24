const log: string[] = [];

class Tracked<T> extends Promise<T> {
  static made = 0;
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void) {
    super(executor);
    Tracked.made++;
  }
}

class ToPlain<T> extends Promise<T> {
  static get [Symbol.species](): PromiseConstructor {
    log.push("promise species");
    return Promise;
  }
}

function name(value: object): string {
  return value.constructor.name;
}

async function promises(): Promise<void> {
  const tracked = Tracked.resolve(1);
  const before = Tracked.made;
  const then = tracked.then(n => n + 1);
  const caught = tracked.catch(() => 0);
  const last = tracked.finally(() => {});
  console.log("a subclass: " + [name(tracked), name(then), name(caught), name(last)].join() + ", made " + (Tracked.made - before) + ", values " + (await then) + " " + (await caught) + " " + (await last));

  const plain = ToPlain.resolve(1);
  const plainThen = plain.then(n => n + 1);
  console.log("a subclass whose species is Promise: " + name(plain) + " " + name(plainThen) + " " + (plainThen instanceof ToPlain) + " " + (await plainThen) + " {" + log.join() + "}");
  log.length = 0;

  const all = Tracked.all([tracked, 2]);
  const race = Tracked.race([tracked]);
  console.log("all and race: " + name(all) + " " + name(race) + " " + JSON.stringify(await all) + " " + (await race));

  const viaAsync = (async () => tracked)();
  console.log("out of an async function: " + name(viaAsync) + " " + (await viaAsync));
}

await promises();

class Bytes extends Uint8Array {
  sum(): number {
    let total = 0;
    for (const b of this) total += b;
    return total;
  }
}

class BytesToPlain extends Uint8Array {
  static get [Symbol.species](): Uint8ArrayConstructor {
    log.push("typed array species");
    return Uint8Array;
  }
}

class BytesToWide extends Uint8Array {
  static get [Symbol.species](): Uint16ArrayConstructor {
    log.push("wide species");
    return Uint16Array;
  }
}

function typed(label: string, source: Uint8Array): void {
  const results: [string, () => object][] = [
    ["map", () => source.map(n => n * 100)],
    ["filter", () => source.filter(n => n > 1)],
    ["slice", () => source.slice(1)],
    ["subarray", () => source.subarray(1)],
    ["toSorted", () => source.toSorted()],
  ];
  for (const [use, run] of results) {
    try {
      const made = run();
      console.log(label + ", " + use + ": " + name(made) + " " + String(made) + " {" + log.join() + "}");
    } catch (error) {
      console.log(label + ", " + use + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " {" + log.join() + "}");
    }
    log.length = 0;
  }
}

typed("a plain typed array", Uint8Array.of(1, 2, 3));
typed("a subclass", Bytes.of(1, 2, 3));
typed("species is the plain one", BytesToPlain.of(1, 2, 3));
typed("species is a wider one", BytesToWide.of(1, 2, 3));

class Chunk extends ArrayBuffer {
  static get [Symbol.species](): ArrayBufferConstructor {
    log.push("buffer species");
    return ArrayBuffer;
  }
}

class SameChunk extends ArrayBuffer {}

console.log("array buffers: " + name(new Chunk(8).slice(2)) + " " + new Chunk(8).slice(2).byteLength + " " + name(new SameChunk(8).slice(2)) + " {" + log.join() + "}");

export {};
