function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

interface Options {
  deep: boolean;
  limit: number;
}

let lines: string[] = [];

function note(word: string, tag?: string, options?: Options): void {
  let line = "word " + text(word) + " | tag " + text(tag) + " | options " + text(options);
  if (tag !== undefined) {
    line += " | tag length " + text(tag.length);
    try {
      line += " | upper " + tag.toUpperCase();
    } catch (error) {
      line += " | upper " + failure(error);
    }
  }
  if (options !== undefined) line += " | deep " + text(options.deep) + " | limit + 1 " + text(options.limit + 1);
  lines.push(line);
}

function each<T>(items: T[], visit: (item: T, index: number, all: T[]) => void): void {
  for (let i = 0; i < items.length; i++) visit(items[i], i, items);
}

function eachBackwards<T>(items: T[], visit: (item: T, left: number) => void): void {
  for (let i = items.length - 1; i >= 0; i--) visit(items[i], i);
}

class Emitter<T> {
  handlers: ((value: T, at: number, from: Emitter<T>) => void)[] = [];
  count = 0;
  on(handler: (value: T, at: number, from: Emitter<T>) => void): this {
    this.handlers.push(handler);
    return this;
  }
  emit(value: T): void {
    for (const handler of this.handlers) handler(value, this.count++, this);
  }
}

function flush(label: string): void {
  for (const line of lines) console.log(label + ": " + line);
  lines = [];
}

const short: (word: string) => void = note;

note("honest");
note("honest", "tag");
note("honest", "tag", { deep: true, limit: 1 });
flush("honest");

for (let i = 0; i < 2000; i++) note("w", "t", { deep: false, limit: i });
console.log("2000 honest calls: " + lines.length + ", last " + lines[1999]);
lines = [];

each(["a", "b"], short);
flush("the program's own loop");

eachBackwards(["a", "b"], short);
flush("a loop that passes two");

new Emitter<string>().on(short).on(word => note(word, "wrapped")).emit("event");
flush("an emitter");

class Listener {
  prefix = "listener";
  seen: string[] = [];
  hear(word: string, tag?: string): void {
    this.seen.push(this.prefix + " " + word + " " + text(tag) + " " + (tag === undefined ? "none" : text(tag.length)));
  }
}
const listener = new Listener();
const hear: (word: string) => void = listener.hear.bind(listener);
listener.hear("honest", "tag");
each(["x", "y"], hear);
console.log(listener.seen.join("\n"));

const table: { [name: string]: (word: string) => void } = { note, short };
each(["t"], table.note);
flush("out of a table");

const list: ((word: string) => void)[] = [note];
each(["l"], list[0]);
flush("out of a list");

function hand(visit: (word: string) => void): void {
  each(["h"], visit);
}
hand(note);
flush("handed on by a function");

note("honest again", "tag");
flush("honest again");
