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

enum Color {
  Red,
  Green,
}

interface Mark {
  side: "left" | "right";
  flag: boolean;
  color: Color;
  id: number | string;
  extra: number;
}
class Mark {
  own: number = 1;
}

function impossible(value: never): string {
  return "reached with " + typeof value + " " + String(value);
}

function sideName(mark: Mark): string {
  switch (mark.side) {
    case "left":
      return "left";
    case "right":
      return "right";
    default:
      return impossible(mark.side);
  }
}

function flagName(mark: Mark): string {
  if (mark.flag === true) return "true";
  else if (mark.flag === false) return "false";
  return impossible(mark.flag);
}

function colorName(mark: Mark): string {
  switch (mark.color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    default: {
      const rest: never = mark.color;
      return "a local typed never holds " + typeof rest;
    }
  }
}

function idName(mark: Mark): string {
  const id = mark.id;
  if (typeof id === "number") return "number " + id;
  if (typeof id === "string") return "string " + id;
  return impossible(id);
}

function extraName(mark: Mark): string {
  const extra = mark.extra;
  if (extra === undefined) return impossible(extra);
  return "number " + extra;
}

function hasExtra(mark: Mark): string {
  if ("extra" in mark) return "it has one";
  return impossible(mark);
}

function filled(i: number): Mark {
  const mark = new Mark();
  mark.side = i % 2 === 0 ? "left" : "right";
  mark.flag = i % 3 === 0;
  mark.color = i % 2 === 0 ? Color.Red : Color.Green;
  mark.id = i % 2 === 0 ? i : "s" + i;
  mark.extra = i;
  return mark;
}

let letters = 0;
for (let i = 0; i < 2000; i++) {
  const mark = filled(i);
  letters += sideName(mark).length + flagName(mark).length + colorName(mark).length + idName(mark).length + extraName(mark).length + hasExtra(mark).length;
}
show("2000 honest rounds", () => letters);

const bare = new Mark();
show("one of two texts", () => sideName(bare));
show("a boolean", () => flagName(bare));
show("an enum", () => colorName(bare));
show("a number or a string", () => idName(bare));
show("a number compared with undefined", () => extraName(bare));
show("in", () => hasExtra(bare));
show("honest again", () => [sideName(filled(1)), flagName(filled(1)), colorName(filled(1)), idName(filled(1)), extraName(filled(1)), hasExtra(filled(1))]);
