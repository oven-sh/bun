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

function readLet(): number {
  return laterLet;
}
function readConst(): string {
  return laterConst;
}
function storeLet(): void {
  laterLet = 1;
}
function kindOfLet(): string {
  return typeof laterLet;
}
function makeLater(): Later {
  return new Later();
}
function staticOfLater(): number {
  return Later.count;
}
function isLater(o: object): boolean {
  return o instanceof Later;
}
function readFunction(): number {
  return laterFunction();
}
function readArrow(): number {
  return laterArrow();
}
function readVar(): number {
  return laterVar;
}
function readEnum(): number {
  return Level.High;
}
function nameOfEnum(n: number): string {
  return Level[n];
}
function readDestructured(): number {
  return fromPattern;
}

function round(label: string): void {
  show(label + " let", readLet);
  show(label + " const", readConst);
  show(label + " typeof let", kindOfLet);
  show(label + " store to let", storeLet);
  show(label + " new class", () => makeLater().value);
  show(label + " static of class", staticOfLater);
  show(label + " instanceof class", () => isLater({}));
  show(label + " function declaration", readFunction);
  show(label + " arrow in a const", readArrow);
  show(label + " var", readVar);
  show(label + " var + 1", () => readVar() + 1);
  show(label + " enum member", readEnum);
  show(label + " enum name", () => nameOfEnum(1));
  show(label + " from a pattern", readDestructured);
}

round("before");

let laterLet: number = 5;
const laterConst: string = "const";
class Later {
  static count: number = 3;
  value: number = 8;
}
function laterFunction(): number {
  return 11;
}
const laterArrow = (): number => 12;
var laterVar: number = 13;
enum Level {
  Low,
  High,
}
const { fromPattern } = { fromPattern: 14 };

round("after");

function inner(): string {
  const out: string[] = [];
  const tryRead = (): void => {
    try {
      out.push(String(local));
    } catch (error) {
      out.push(error instanceof Error ? error.constructor.name : typeof error);
    }
  };
  tryRead();
  const local: number = 21;
  tryRead();
  return out.join();
}
show("inside a function", inner);

function inLoop(): string {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const peek = (): number => each;
    try {
      out.push(String(peek()));
    } catch (error) {
      out.push("threw");
    }
    const each: number = i * 2;
    out.push(String(peek()));
  }
  return out.join();
}
show("in every round of a loop", inLoop);

function inSwitch(which: number): string {
  const peek = (): string => {
    try {
      return String(read());
    } catch (error) {
      return "threw";
    }
  };
  let read: () => number = () => -1;
  switch (which) {
    case 0:
      let chosen: number = 1;
      read = () => chosen;
      return peek();
    default:
      read = () => chosen;
      return peek();
  }
}
show("a switch that enters at the declaration", () => inSwitch(0));
show("a switch that jumps over it", () => inSwitch(1));
