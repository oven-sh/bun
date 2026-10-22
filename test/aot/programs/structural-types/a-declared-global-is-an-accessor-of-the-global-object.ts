function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare const ticking: number;
declare let guarded: number;
declare const shifting: number;

const log: string[] = [];
let ticks = 0;
let held = 0;

Object.defineProperty(globalThis, "ticking", {
  get(): number {
    log.push("get ticking");
    return ++ticks;
  },
  configurable: true,
});

Object.defineProperty(globalThis, "guarded", {
  get(): number {
    log.push("get guarded");
    return held;
  },
  set(value: number) {
    log.push("set guarded " + value);
    held = value * 2;
  },
  configurable: true,
});

Object.defineProperty(globalThis, "shifting", {
  get(): unknown {
    return ticks % 2 === 0 ? ticks : "odd " + ticks;
  },
  configurable: true,
});

function tick(): number {
  return ticking;
}

function flush(): string {
  const all = log.join();
  log.length = 0;
  return all;
}

show("each read runs the getter", () => [ticking, ticking, tick()]);
show("what ran", () => flush());
show("twice in one sum", () => ticking + ticking);
show("compared with itself", () => ticking === ticking);
show("typeof runs it too", () => typeof ticking);
show("what ran", () => flush());
show("in a loop", () => {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += ticking;
  return sum;
});
show("what ran", () => flush());
show("a read whose value is dropped", () => {
  ticking;
  return ticks;
});
show("what ran", () => flush());

show("a store runs the setter", () => (guarded = 4));
show("and the read sees what the setter kept", () => guarded);
show("+=", () => (guarded += 1));
show("++", () => [guarded++, guarded]);
show("what ran", () => flush());

show("a getter that answers two types", () => {
  const seen: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    seen.push(shifting, shifting + 1);
    tick();
  }
  return seen;
});
flush();

const before = ticks;
let sum = 0;
for (let i = 0; i < 2000; i++) sum += tick();
show("2000 reads", () => [sum, ticks - before, log.length]);
