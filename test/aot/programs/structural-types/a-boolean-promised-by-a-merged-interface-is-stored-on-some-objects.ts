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

interface Door {
  open: boolean;
}
class Door {
  id: number = 1;
  state(): string {
    return this.open ? "open" : "shut";
  }
}

function openOf(door: Door): boolean {
  return door.open;
}

function isShut(door: Door): boolean {
  return door.open === false;
}

function filled(open: boolean): Door {
  const made = new Door();
  made.open = open;
  return made;
}

show("the first call gets one without it", () => [openOf(new Door()), isShut(new Door())]);
let count = 0;
let shut = 0;
for (let i = 0; i < 2000; i++) {
  if (openOf(filled(i % 2 === 0))) count++;
  if (isShut(filled(i % 4 === 0))) shut++;
}
show("2000 with it", () => [count, shut]);
show("one without it", () => openOf(new Door()));
show("is it shut", () => isShut(new Door()));
show("its state", () => new Door().state());
show("one with it again", () => [openOf(filled(true)), isShut(filled(false)), filled(true).state()]);
show("three of them", () => [filled(true), new Door(), filled(false)].map(openOf));
show("how many are shut", () => [filled(true), new Door(), filled(false)].filter(isShut).length);
show("how many are not open", () => [filled(true), new Door(), filled(false)].filter(d => !d.open).length);
show("keys of both", () => [Object.keys(filled(true)), Object.keys(new Door())]);
show("JSON of both", () => JSON.stringify([filled(false), new Door()]));

const late = new Door();
show("before the store", () => [late.open, "open" in late]);
late.open = false;
show("after the store", () => [late.open, "open" in late, isShut(late)]);
const toggled = new Door();
toggled.open = !toggled.open;
show("toggled where there was nothing", () => [toggled.open, toggled.state()]);
const either = new Door();
show("||= where there is nothing", () => (either.open ||= true));
show("&&= where there is nothing", () => (new Door().open &&= true));
