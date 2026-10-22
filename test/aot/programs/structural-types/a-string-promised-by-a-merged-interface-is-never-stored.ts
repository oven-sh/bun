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

interface Label {
  note: string;
}
class Label {
  id: number = 1;
  heading(): string {
    return this.note + "!";
  }
}

function size(s: string): number {
  return s.length;
}

function noteOf(label: Label): string {
  return label.note;
}

const label = new Label();
show("read", () => label.note);
show("typeof", () => typeof label.note);
show("followed by a string", () => label.note + "!");
show("after a string", () => "<" + label.note);
show("in a template", () => `[${label.note}]`);
show("equals the empty string", () => label.note === "");
show("equals undefined", () => label.note === undefined);
show("as a condition", () => (label.note ? "yes" : "no"));
show("or a default", () => label.note ?? "default");
show("or a default by ||", () => label.note || "default");
show("less than", () => label.note < "a");
show("length", () => label.note.length);
show("length if there", () => label.note?.length);
show("toUpperCase", () => label.note.toUpperCase());
show("charCodeAt", () => label.note.charCodeAt(0));
show("first character", () => label.note[0]);
show("slice", () => label.note.slice(1));
show("iterated", () => [...label.note]);
show("String", () => String(label.note));
show("Number", () => Number(label.note));
show("joined", () => [label.note, "b"].join("-"));
show("as a key", () => ({ [label.note]: 1 }));
show("includes as an argument", () => "is undefined here".includes(label.note));
show("in a method", () => label.heading());
show("through a function", () => noteOf(label));
show("given to a typed function", () => size(label.note));
show("a typed local", () => {
  const s: string = label.note;
  return s;
});
show("a typed element", () => {
  const list: string[] = [label.note, "b"];
  return list;
});
show("in a switch", () => {
  switch (label.note) {
    case "":
      return "empty";
    case "undefined":
      return "the word";
    default:
      return "neither";
  }
});
show("in", () => "note" in label);
show("keys", () => Object.keys(label));
show("JSON", () => JSON.stringify(label));
show("spread", () => ({ ...label }));
