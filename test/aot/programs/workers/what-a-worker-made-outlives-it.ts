// A Worker posts texts of the program, names of properties and functions, joined and sliced texts, errors with stacks, buffers it made, shared memory, maps. It is terminated, the main thread collects, more Workers come and go, and then everything is read.
class Record2 {
  firstField = "the text of a field";
  secondField = 2;
  method(): string {
    return "a text that a method returns";
  }
}
enum Color {
  Red = "RED",
  Green = "GREEN",
}
const table = { alpha: "ALPHA", beta: "BETA" } as const;
function parcel(seed: number) {
  const record = new Record2();
  const joined = "joined " + seed + " " + record.firstField;
  const shared = new SharedArrayBuffer(64);
  new Uint8Array(shared).fill(seed);
  let error: Error;
  try {
    (undefined as any).nothing;
    error = new Error("unreachable");
  } catch (caught) {
    error = caught as Error;
  }
  return {
    constant: "a constant text of the program",
    template: `template ${seed}`,
    keys: Object.keys(record),
    names: [parcel.name, Record2.name, record.method.name, Color.Red, table.beta, typeof record, String(Symbol("described").description)],
    returned: record.method(),
    joined,
    sliced: joined.slice(3, 12),
    repeated: "ab".repeat(1000),
    upper: record.firstField.toUpperCase(),
    number: String(seed * 1.5),
    json: JSON.stringify(record),
    error,
    custom: new RangeError("made in the worker " + seed, { cause: record.firstField }),
    bytes: new Uint8Array(1 << 16).fill(seed),
    moved: new Uint8Array(1 << 16).fill(seed + 1),
    shared,
    map: new Map<string, string[]>([[record.firstField, Object.keys(table)]]),
    record,
    date: new Date(seed),
    pattern: /from the worker/gi,
    big: 2n ** 100n + BigInt(seed),
  };
}
function read(got: ReturnType<typeof parcel>): string {
  return [got.constant, got.template, got.keys.join(), got.names.join(), got.returned, got.joined, got.sliced, got.repeated.length, got.upper, got.number, got.json, got.error.name, got.error.message.length > 0, typeof got.error.stack, got.custom.message, got.custom.cause,
    got.bytes[65535], got.moved[65535], new Uint8Array(got.shared)[63], [...got.map].join(), got.record.firstField, got.record.secondField, got.date.getTime(), got.pattern.source, got.big].join(" | ");
}

if (Bun.isMainThread) {
  const kept: ReturnType<typeof parcel>[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const worker = new Worker(new URL(import.meta.url));
    kept.push(await new Promise(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.postMessage(seed);
    }));
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    worker.terminate();
    await closed;
    Bun.gc(true);
  }
  let same = 0;
  kept.forEach((got, index) => (read(got) === read(parcel(index + 1)) ? same++ : console.log("ANOTHER", read(got), "\n", read(parcel(index + 1)))));
  console.log("as made here:", same);
  console.log(read(kept[4]));
} else {
  addEventListener("message", (event: MessageEvent<number>) => {
    const made = parcel(event.data);
    postMessage(made, [made.moved.buffer]);
  });
}
