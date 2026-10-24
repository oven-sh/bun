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

interface Mark {
  kind: "circle";
  one: 1;
  yes: true;
  no: false;
  none: null;
  side: "left" | "right";
}
class Mark {
  id: number = 1;
  isCircle(): boolean {
    return this.kind === "circle";
  }
  two(): number {
    return this.one + 1;
  }
}

function kindOf(mark: Mark): "circle" {
  return mark.kind;
}

function sideName(mark: Mark): string {
  switch (mark.side) {
    case "left":
      return "it is left";
    case "right":
      return "it is right";
  }
}

function otherSide(mark: Mark): string {
  return mark.side === "left" ? "right" : "left";
}

const mark = new Mark();
show("the text: read", () => mark.kind);
show("the text: is it what its type says", () => mark.kind === "circle");
show("the text: is it something else", () => mark.kind !== "circle");
show("the text: length", () => mark.kind.length);
show("the text: in a method", () => mark.isCircle());
show("the text: through a function", () => kindOf(mark));
show("the text: in a template", () => `${mark.kind}`);
show("the number: read", () => mark.one);
show("the number: is it what its type says", () => mark.one === 1);
show("the number: plus one", () => mark.one + 1);
show("the number: in a method", () => mark.two());
show("the number: as an index", () => ["zero", "one"][mark.one]);
show("true: read", () => mark.yes);
show("true: as a condition", () => (mark.yes ? "yes" : "no"));
show("true: is it what its type says", () => mark.yes === true);
show("false: read", () => mark.no);
show("false: is it what its type says", () => mark.no === false);
show("false: not", () => !mark.no);
show("null: read", () => mark.none);
show("null: is it what its type says", () => mark.none === null);
show("null: or a default", () => mark.none ?? "default");
show("one of two: read", () => mark.side);
show("one of two: a switch over both", () => sideName(mark));
show("one of two: if it is not left", () => otherSide(mark));
show("keys", () => Object.keys(mark));
show("JSON", () => JSON.stringify(mark));

mark.kind = "circle";
mark.one = 1;
mark.yes = true;
mark.side = "right";
show("after honest stores", () => [mark.isCircle(), mark.two(), mark.yes ? "yes" : "no", sideName(mark), otherSide(mark)]);
show("another instance", () => [new Mark().isCircle(), new Mark().two(), sideName(new Mark()), otherSide(new Mark())]);
