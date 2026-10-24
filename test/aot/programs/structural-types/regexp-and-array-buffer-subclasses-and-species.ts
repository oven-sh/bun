function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

const log: string[] = [];

class Loud extends RegExp {
  exec(text: string): RegExpExecArray | null {
    log.push("exec at " + this.lastIndex);
    return super.exec(text);
  }
}

class Chunk extends ArrayBuffer {
  half(): number {
    return this.byteLength / 2;
  }
}

class PlainChunks extends ArrayBuffer {
  static get [Symbol.species](): ArrayBufferConstructor {
    return ArrayBuffer;
  }
}

function test(pattern: RegExp, text: string): boolean {
  return pattern.test(text);
}

function pieces(pattern: RegExp, text: string): string[] {
  return text.split(pattern);
}

function swapped(pattern: RegExp, text: string): string {
  return text.replace(pattern, "-");
}

function found(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length;
}

function firstHalf(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0, buffer.byteLength / 2);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += (test(/a/, "banana") ? 1 : 0) + pieces(/a/, "banana").length + swapped(/a/g, "banana").length + found(/a/g, "banana") + firstHalf(new ArrayBuffer(8)).byteLength;
console.log("after 2000 plain values", warm);

function logged(label: string, run: () => unknown): void {
  log.length = 0;
  attempt(label, run);
  console.log("  log: " + log.join("; "));
}

logged("test", () => test(new Loud("a"), "banana"));
logged("split", () => pieces(new Loud("a"), "banana"));
logged("replace", () => swapped(new Loud("a", "g"), "banana"));
logged("matchAll", () => found(new Loud("a", "g"), "banana"));
logged("match", () => "banana".match(new Loud("a", "g")));
logged("search", () => "banana".search(new Loud("n")));
logged("what it is", () => [new Loud("a") instanceof RegExp, new Loud("a").constructor.name, String(new Loud("a", "g"))]);
logged("a copy made by RegExp", () => [new RegExp(new Loud("a", "g")).constructor.name, test(new RegExp(new Loud("a", "g")), "banana")]);
logged("a plain pattern again", () => [test(/a/, "banana"), pieces(/a/, "banana")]);

attempt("a slice of a chunk", () => {
  const part = firstHalf(new Chunk(8));
  return [part.constructor.name, part.byteLength, part instanceof Chunk ? part.half() : "no chunk"];
});
attempt("a slice with species ArrayBuffer", () => {
  const part = firstHalf(new PlainChunks(8));
  return [part.constructor.name, part.byteLength];
});
attempt("a transferred chunk", () => {
  const chunk = new Chunk(8);
  const moved = chunk.transfer();
  return [moved.constructor.name, moved.byteLength, chunk.byteLength, chunk.detached];
});
attempt("a clone of a chunk", () => [structuredClone(new Chunk(8)).constructor.name, typeof structuredClone(new Chunk(8)).half]);
attempt("bytes over a chunk", () => [new Uint8Array(new Chunk(8)).buffer.constructor.name, new Uint8Array(new Chunk(8)).slice().buffer.constructor.name]);
