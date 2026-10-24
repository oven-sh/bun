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

interface Setter {
  set(v: number | string | undefined): void;
}

let moduleNumber: number = 1;
function readModule(): number {
  return moduleNumber;
}
function modulePlusOne(): number {
  return moduleNumber + 1;
}
const moduleSetter: Setter = {
  set(v: number) {
    moduleNumber = v;
  },
};

function makeCell(): { setter: Setter; read: () => number; plusOne: () => number; bump: () => number } {
  let cell: number = 1;
  return {
    setter: {
      set(v: number) {
        cell = v;
      },
    },
    read: () => cell,
    plusOne: () => cell + 1,
    bump: () => ++cell,
  };
}

interface Installer {
  install(f: ((n: number) => number) | string | undefined): void;
}
let action: (n: number) => number = n => n * 2;
function runAction(n: number): number {
  return action(n);
}
const installer: Installer = {
  install(f: (n: number) => number) {
    action = f;
  },
};

let total = 0;
for (let i = 0; i < 2000; i++) {
  moduleSetter.set(i);
  total += readModule();
}
show("2000 honest stores", () => total);
moduleSetter.set("text");
show("module: a string", readModule);
show("module: plus one", modulePlusOne);
show("module: direct", () => moduleNumber);
show("module: typeof", () => typeof moduleNumber);
moduleSetter.set(undefined);
show("module: undefined", readModule);
show("module: plus one", modulePlusOne);
moduleSetter.set(2.5);
show("module: a number again", modulePlusOne);

const cell = makeCell();
show("cell: start", cell.read);
cell.setter.set(4);
show("cell: 4", cell.plusOne);
cell.setter.set("text");
show("cell: a string", cell.read);
show("cell: plus one", cell.plusOne);
show("cell: bump", cell.bump);
show("cell: after the bump", cell.read);
cell.setter.set(undefined);
show("cell: undefined", cell.read);
show("cell: plus one", cell.plusOne);
const other = makeCell();
show("another cell is untouched", other.plusOne);

show("action: start", () => runAction(2));
installer.install(n => n + 100);
show("action: replaced", () => runAction(2));
installer.install("not a function");
show("action: a string", () => runAction(2));
show("action: typeof", () => typeof action);
installer.install(undefined);
show("action: undefined", () => runAction(2));
installer.install(Math.abs);
show("action: a built-in", () => runAction(-2));
