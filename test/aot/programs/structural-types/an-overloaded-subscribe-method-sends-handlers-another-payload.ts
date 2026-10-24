function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Chunk {
  bytes: number;
  label: string;
  constructor(bytes: number, label: string) {
    this.bytes = bytes;
    this.label = label;
  }
  describe(): string {
    return this.label + " of " + this.bytes;
  }
}

type Payload = string | number | Chunk | undefined;

interface Handler<T> {
  handle(payload: T): void;
}

class Hub {
  handlers = new Map<string, Handler<Payload>[]>();
  on(event: "text", handler: Handler<string>): void;
  on(event: "count", handler: Handler<number>): void;
  on(event: "chunk", handler: Handler<Chunk>): void;
  on(event: "end", handler: Handler<undefined>): void;
  on(event: string, handler: Handler<Payload>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  send(event: string, payload: Payload): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler.handle(payload);
      } catch (error) {
        console.log("  the handler of " + event + " " + failure(error));
      }
    }
  }
}

const hub = new Hub();

let total = 0;
let quiet = 0;

class Summing implements Handler<number> {
  sum: number = 0;
  handle(n: number): void {
    this.sum += n;
    quiet += n;
  }
}
const summing = new Summing();

hub.on("text", {
  handle(line) {
    console.log("  text: " + text(line) + ", length " + text(line.length) + ", upper " + line.toUpperCase());
  },
});
hub.on("count", {
  handle(n) {
    total += n;
    console.log("  count: " + text(n) + ", doubled " + text(n * 2) + ", total " + text(total));
  },
});
hub.on("chunk", {
  handle(chunk) {
    console.log("  chunk: " + text(chunk) + ", bytes + 1 " + text(chunk.bytes + 1) + ", " + chunk.describe());
  },
});
hub.on("end", {
  handle(nothing) {
    console.log("  end: " + arguments.length + " arguments, first " + text(nothing) + ", undefined " + (nothing === undefined));
  },
});

const payloads: [string, Payload][] = [
  ["a text", "line"],
  ["a number", 5],
  ["a chunk", new Chunk(3, "c")],
  ["nothing", undefined],
];

console.log("honest:");
hub.send("text", "line");
hub.send("count", 5);
hub.send("chunk", new Chunk(3, "c"));
hub.send("end", undefined);

for (let i = 0; i < 2000; i++) summing.handle(1);
console.log("2000 honest counts: " + quiet + " " + summing.sum);
hub.on("count", summing);

for (const event of ["text", "count", "chunk", "end"]) {
  for (const [label, payload] of payloads) {
    console.log(event + " gets " + label + ":");
    hub.send(event, payload);
  }
}
console.log("total " + text(total) + ", quiet " + text(quiet) + ", sum " + text(summing.sum) + ", " + JSON.stringify(summing));

console.log("honest again:");
total = 0;
hub.send("count", 1);
hub.send("text", "again");
