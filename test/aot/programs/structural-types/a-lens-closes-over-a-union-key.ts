function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

interface Lens<T, V> {
  get(target: T): V;
  set(target: T, value: V): void;
}

function lens<T, K extends keyof T>(key: K): Lens<T, T[K]> {
  return {
    get: target => target[key],
    set: (target, value) => {
      target[key] = value;
    },
  };
}

class Track {
  length = 180;
  gain = 0.5;
  title = "song";
  minutes(): number {
    return this.length / 60;
  }
  louder(): number {
    return this.gain + 0.25;
  }
  shout(): string {
    return this.title.toUpperCase();
  }
}

const yes: boolean = process.argv.length > 0;

const lengthLens = lens<Track, "length">("length");
const titleLens = lens<Track, "title">("title");
const either = lens<Track, "length" | "title">(yes ? "length" : "title");
const other = lens<Track, "length" | "title">(yes ? "title" : "length");
const gainOrTitle = lens<Track, "gain" | "title">(yes ? "gain" : "title");

function report(title: string, t: Track): void {
  console.log(title + ": " + typeof t.length + " " + show(t.length) + ", " + typeof t.gain + " " + show(t.gain) + ", " + typeof t.title + " " + show(t.title) + ", " + JSON.stringify(t));
  attempt("  minutes", () => t.minutes());
  attempt("  louder", () => t.louder());
  attempt("  shout", () => t.shout());
  attempt("  the honest lens reads the length + 1", () => lengthLens.get(t) + 1);
  attempt("  the honest lens reads the title's length", () => titleLens.get(t).length);
}

const t = new Track();
let total = 0;
for (let i = 0; i < 2000; i++) {
  lengthLens.set(t, i);
  titleLens.set(t, "t" + (i % 4));
  either.set(t, i + 1);
  other.set(t, "u" + (i % 4));
  total += t.minutes() + t.shout().length + lengthLens.get(t);
}
console.log("2000 honest rounds: " + total);
report("honest", t);

either.set(t, "three minutes");
report("a string through the lens over the length", t);
other.set(t, 3);
report("a number through the lens over the title", t);
gainOrTitle.set(t, "loud");
report("a string through the lens over the gain", t);
either.set(t, other.get(t));
report("one lens feeds the other", t);
lengthLens.set(t, 60);
titleLens.set(t, "end");
gainOrTitle.set(t, 1);
report("honest again", t);

export {};
