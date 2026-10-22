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

interface Sized {
  width: number;
  height: number;
  label: string;
}

class Ghost implements Sized {
  declare width: number;
  declare height: number;
  declare label: string;
  id: number = 1;
}

class Solid implements Sized {
  width: number = 2;
  height: number = 3;
  label: string = "solid";
}

function area(sized: Sized): number {
  return sized.width * sized.height;
}

function caption({ width, label }: Sized): string {
  return label + " " + width;
}

function labelWidth(sized: Sized): number {
  return sized.label.length;
}

function widest(all: Sized[]): number {
  let best = 0;
  for (const sized of all) if (sized.width > best) best = sized.width;
  return best;
}

show("the first call gets the ghost", () => area(new Ghost()));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const sized: Sized = i % 2 === 0 ? new Solid() : { width: i, height: 1, label: "literal" };
  sum += area(sized) + caption(sized).length + labelWidth(sized);
}
show("2000 honest rounds", () => sum);

const ghost = new Ghost();
show("area", () => area(ghost));
show("caption", () => caption(ghost));
show("the length of the label", () => labelWidth(ghost));
show("members", () => [ghost.width, ghost.height, ghost.label]);
show("keys", () => Object.keys(ghost));
show("spread", () => ({ ...ghost }));
show("spread under the interface", () => {
  const copy: Sized = { ...ghost };
  return [copy.width, area(copy), Object.keys(copy)];
});
show("the widest of three", () => widest([new Solid(), ghost, { width: 5, height: 1, label: "l" }]));
show("areas of three", () => [new Solid(), ghost, { width: 5, height: 1, label: "l" }].map(area));

ghost.height = 4;
show("half filled", () => [area(ghost), Object.keys(ghost)]);
ghost.width = 5;
ghost.label = "ghost";
show("filled in another order", () => [area(ghost), caption(ghost), labelWidth(ghost), Object.keys(ghost)]);
show("honest again", () => [area(new Solid()), caption({ width: 1, height: 1, label: "x" })]);
