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
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  heading(): string {
    return this.note + "!";
  }
  width(): number {
    return this.note.length;
  }
}

function filled(id: number, note: string): Label {
  const label = new Label(id);
  label.note = note;
  return label;
}

function noteOf(label: Label): string {
  return label.note;
}

function widthOf(label: Label): number {
  return label.note.length;
}

show("the first call gets one without it", () => noteOf(new Label(1)));
show("its width", () => widthOf(new Label(1)));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += widthOf(filled(i, "ab")) + noteOf(filled(i, "c")).length + filled(i, "def").width();
show("2000 with it", () => sum);
show("one without it", () => noteOf(new Label(5)));
show("its width", () => widthOf(new Label(5)));
show("its width by the method", () => new Label(5).width());
show("its heading", () => new Label(5).heading());
show("one with it again", () => [noteOf(filled(1, "xyz")), widthOf(filled(1, "xyz"))]);

show("all notes joined", () => [filled(1, "a"), new Label(2), filled(3, "c")].map(noteOf).join("+"));
show("all notes added", () => {
  let all = "";
  for (const label of [filled(1, "a"), new Label(2), filled(3, "c")]) all += label.note;
  return all;
});
show("keys of both", () => [Object.keys(filled(1, "a")), Object.keys(new Label(1))]);
show("JSON of both", () => JSON.stringify([filled(1, "a"), new Label(1)]));

const late = new Label(1);
show("before the store", () => [late.note, "note" in late]);
late.note = "late";
show("after the store", () => [late.note, "note" in late, late.width(), late.heading()]);

const added = new Label(1);
show("+= where there is nothing", () => (added.note += "tail"));
show("after it", () => [added.note, added.width(), Object.keys(added)]);
