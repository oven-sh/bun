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

class Widget {
  declare width: number;
  declare title: string;
  id: number = 1;
  doubleWidth(): number {
    return this.width * 2;
  }
  banner(): string {
    return "[" + this.title + "]";
  }
}

class Sized extends Widget {
  width: number = 10;
  title: string = "sized";
}

class Stored extends Widget {
  constructor() {
    super();
    this.title = "stored";
    this.width = 20;
  }
}

class Unsized extends Widget {
  color: string = "red";
}

class AgainDeclared extends Widget {
  declare width: number;
  depth: number = 2;
}

function widthOf(widget: Widget): number {
  return widget.width;
}

show("the first call gets one without", () => widthOf(new Unsized()));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const widget = i % 2 === 0 ? new Sized() : new Stored();
  sum += widthOf(widget) + widget.doubleWidth() + widget.banner().length;
}
show("2000 that make it", () => sum);

for (const widget of [new Sized(), new Stored(), new Unsized(), new AgainDeclared(), new Widget()]) {
  const kind = widget.constructor.name;
  show(kind + ": width", () => widthOf(widget));
  show(kind + ": double", () => widget.doubleWidth());
  show(kind + ": banner", () => widget.banner());
  show(kind + ": the length of the title", () => widget.title.length);
  show(kind + ": keys", () => Object.keys(widget));
}
