function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

const log: string[] = [];
const target = new EventTarget();

class Detailed extends Event {
  detail: number;
  note: string;
  constructor(type: string, detail: number, note: string) {
    super(type);
    this.detail = detail;
    this.note = note;
  }
  twice(): number {
    return this.detail * 2;
  }
}

let total = 0;
target.addEventListener("tick", {
  handleEvent(e: Detailed) {
    total += e.detail;
    log.push("detail " + typeof e.detail + " " + e.detail);
  },
});
target.addEventListener("tick", {
  handleEvent(e: Detailed) {
    log.push("note " + typeof e.note + " " + e.note);
  },
});
target.addEventListener("tick", {
  handleEvent(e: Detailed) {
    try {
      log.push("twice " + e.twice());
    } catch (error) {
      log.push("twice threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  },
});
target.addEventListener("tick", {
  handleEvent(e: Detailed) {
    try {
      log.push("note length " + e.note.length);
    } catch (error) {
      log.push("note length threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  },
});

show("a detailed event", () => target.dispatchEvent(new Detailed("tick", 5, "five")));
show("total", () => total);
show("a plain event", () => target.dispatchEvent(new Event("tick")));
show("total", () => total);
total = 0;
show("a detailed event again", () => target.dispatchEvent(new Detailed("tick", 6, "six")));
show("total", () => total);
for (const entry of log) console.log(entry);
