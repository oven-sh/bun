function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Mode = "on" | "off";
type Level = 0 | 1 | 2;

class Switch {
  mode: Mode = "on";
  level: Level = 0;
  armed: boolean = true;
  big: 1n | 2n = 1n;
}

type Between = (s: Switch) => void;
const keep: Between = () => {};
const flip: Between = s => {
  s.mode = "off";
  s.level = 2;
  s.armed = false;
  s.big = 2n;
};

const costs = { on: 10, off: 20 };
const names = ["zero", "one", "two"];

function onlyOn(m: "on"): string {
  return m + "!";
}

function onlyZero(l: 0): number {
  return l + 100;
}

function word(m: Mode): string {
  switch (m) {
    case "on":
      return "lit";
    case "off":
      return "dark";
  }
}

const uses: [string, (s: Switch, between: Between) => unknown][] = [
  ["a string, read", (s, between) => (s.mode === "on" ? (between(s), s.mode) : "other")],
  ["a string, compared again", (s, between) => (s.mode === "on" ? (between(s), s.mode === "on") : "other")],
  ["a string, as a key", (s, between) => (s.mode === "on" ? (between(s), costs[s.mode]) : "other")],
  ["a string, handed on", (s, between) => (s.mode === "on" ? (between(s), onlyOn(s.mode)) : "other")],
  ["a string, switched on", (s, between) => (s.mode === "on" ? (between(s), word(s.mode)) : "other")],
  ["a string, in a template", (s, between) => (s.mode === "on" ? (between(s), `<${s.mode}>`) : "other")],
  ["a string, its length", (s, between) => (s.mode === "on" ? (between(s), s.mode.length) : "other")],
  ["a string, by exclusion", (s, between) => (s.mode !== "off" ? (between(s), s.mode) : "other")],
  ["a number, read", (s, between) => (s.level === 0 ? (between(s), s.level) : "other")],
  ["a number, plus one", (s, between) => (s.level === 0 ? (between(s), s.level + 1) : "other")],
  ["a number, as an index", (s, between) => (s.level === 0 ? (between(s), names[s.level]) : "other")],
  ["a number, handed on", (s, between) => (s.level === 0 ? (between(s), onlyZero(s.level)) : "other")],
  ["a number, tested", (s, between) => (s.level === 0 ? (between(s), s.level ? "truthy" : "falsy") : "other")],
  ["a number, falsy", (s, between) => (!s.level ? (between(s), s.level) : "other")],
  ["a number, by exclusion", (s, between) => (s.level !== 1 && s.level !== 2 ? (between(s), s.level) : "other")],
  ["a boolean, read", (s, between) => (s.armed ? (between(s), s.armed) : "other")],
  ["a boolean, tested", (s, between) => (s.armed ? (between(s), s.armed ? "yes" : "no") : "other")],
  ["a boolean, negated", (s, between) => (s.armed === true ? (between(s), !s.armed) : "other")],
  ["a bigint, read", (s, between) => (s.big === 1n ? (between(s), s.big) : "other")],
  ["a bigint, doubled", (s, between) => (s.big === 1n ? (between(s), s.big * 2n) : "other")],
];

class Owner {
  mode: Mode = "on";
  change(really: boolean): void {
    if (really) this.mode = "off";
  }
  inItsOwnField(really: boolean): unknown {
    if (this.mode === "on") {
      this.change(really);
      return [this.mode, costs[this.mode], onlyOn(this.mode)];
    }
    return "other";
  }
}

function inAnElement(modes: Mode[], really: boolean): unknown {
  const change = (): void => {
    if (really) modes[0] = "off";
  };
  if (modes[0] === "on") {
    change();
    return [modes[0], costs[modes[0]], onlyOn(modes[0])];
  }
  return "other";
}

function inACapturedVariable(really: boolean): unknown {
  let m: Mode = "on";
  const change = (): void => {
    if (really) m = "off";
  };
  if (m === "on") {
    change();
    return [m, costs[m], onlyOn(m)];
  }
  return "other";
}

function round(label: string, between: Between, really: boolean): void {
  for (const [name, use] of uses) attempt(label + " " + name, () => use(new Switch(), between));
  attempt(label + " in its own field", () => new Owner().inItsOwnField(really));
  attempt(label + " in an element", () => inAnElement(["on"], really));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
}

round("honest", keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use(new Switch(), keep);
  new Owner().inItsOwnField(false);
  inAnElement(["on"], false);
  inACapturedVariable(false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("flipped", flip, true);
round("honest again", keep, false);
