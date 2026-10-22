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

class Base {
  constructor() {
    try {
      this.start();
    } catch (error) {
      log.push("start threw " + (error instanceof Error ? error.constructor.name : typeof error));
    }
  }
  start(): void {
    log.push("base start");
  }
}

class Arrow extends Base {
  count: number = 1;
  handler: () => number = () => this.count;
  start(): void {
    log.push("typeof handler " + typeof this.handler);
    log.push("handler() " + this.handler());
  }
}

class ArrowOverMethod extends Base {
  start = (): void => {
    log.push("the arrow in the field ran");
  };
}

class Bound extends Base {
  count: number = 2;
  read = this.plainRead.bind(this);
  plainRead(): number {
    return this.count;
  }
  start(): void {
    log.push("plainRead() " + this.plainRead());
    log.push("typeof read " + typeof this.read);
    log.push("read() " + this.read());
  }
}

class Listeners extends Base {
  listeners: (() => string)[] = [() => "one"];
  start(): void {
    log.push("typeof listeners " + typeof this.listeners);
    for (const listener of this.listeners) log.push(listener());
  }
}

class Kept extends Base {
  value: number = 3;
  early: (() => number) | undefined;
  start(): void {
    saved = () => this.value;
    log.push("saved() early " + saved());
  }
}
let saved: () => number = () => -1;

function flush(title: string): void {
  for (const entry of log) console.log(title + ": " + entry);
  log.length = 0;
}

const arrow = new Arrow();
flush("arrow, early");
arrow.start();
flush("arrow, late");

const over = new ArrowOverMethod();
flush("arrow over a method, early");
over.start();
flush("arrow over a method, late");
show("own start", () => Object.hasOwn(over, "start"));

const bound = new Bound();
flush("bound, early");
bound.start();
flush("bound, late");

const listeners = new Listeners();
flush("listeners, early");
listeners.start();
flush("listeners, late");

new Kept();
flush("kept, early");
show("saved() late", () => saved());
