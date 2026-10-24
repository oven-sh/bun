function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Sink {
  got = 0;
  set level(value: number) {
    this.got = value;
  }
}

const sink = new Sink();
sink.level = 8;
say("write only: is undefined", sink.level === undefined);
say("write only: is loosely null", sink.level == null);
say("write only: typeof is number", typeof sink.level === "number");
say("write only: typeof is undefined", typeof sink.level === "undefined");
say("write only: a default", sink.level ?? 9);
say("write only: an optional call", sink.level?.toFixed(1));
say("write only: truthy", sink.level ? "truthy" : "falsy");
say("write only: is NaN", Number.isNaN(sink.level));

class Gauge {
  raw: number | string = 1;
  spoil(): void {
    this.raw = "text";
  }
  get level(): number {
    if (typeof this.raw === "number") {
      this.spoil();
      return this.raw;
    }
    return -1;
  }
}

const level = new Gauge().level;
say("a getter typed number: typeof is number", typeof level === "number");
say("a getter typed number: typeof is string", typeof level === "string");
say("a getter typed number: is an integer", Number.isInteger(level));
say("a getter typed number: equals itself", level === level);
say("a getter typed number: greater than zero", level > 0);
say("a getter typed number, read in place: typeof is number", typeof new Gauge().level === "number");

interface Sized {
  get size(): number;
  set size(value: number | string);
}

class Plain {
  size = 1;
}

const plain = new Plain();
const view: Sized = plain;
view.size = "text";
say("a number field: typeof is number", typeof plain.size === "number");
say("a number field: typeof is string", typeof plain.size === "string");
say("a number field: is finite", Number.isFinite(plain.size));
say("a number field: through the view", typeof view.size === "number");

class TakesText {
  kept = "start";
  get v(): number {
    return this.kept.length;
  }
  set v(value: string) {
    this.kept = value;
  }
}

function store(o: { v: number }): void {
  o.v = 12;
}

const takes = new TakesText();
store(takes);
say("a string field: typeof is string", typeof takes.kept === "string");
say("a string field: typeof is number", typeof takes.kept === "number");
say("the getter over it: is undefined", takes.v === undefined);
say("the getter over it: typeof is number", typeof takes.v === "number");
