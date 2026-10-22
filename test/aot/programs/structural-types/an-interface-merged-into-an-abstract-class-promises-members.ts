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

interface Reader {
  position: number;
  source: string;
  close(): void;
}
abstract class Reader {
  abstract read(): string;
  steps: number = 0;
  advance(): number {
    this.steps++;
    return this.position + this.steps;
  }
  rest(): string {
    return this.source.slice(this.position);
  }
}

class Plain extends Reader {
  read(): string {
    return "plain at " + this.position;
  }
}

class Full extends Reader {
  position: number = 2;
  source: string = "abcdef";
  read(): string {
    return this.source[this.position];
  }
  close(): void {
    this.position = -1;
  }
}

function positionOf(reader: Reader): number {
  return reader.position;
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += positionOf(new Full()) + new Full().advance() + new Full().rest().length;
show("2000 that make them", () => sum);

const plain = new Plain();
show("read", () => [plain.position, plain.source, plain.close]);
show("through a function", () => positionOf(plain));
show("its own method", () => plain.read());
show("an inherited method with the number", () => plain.advance());
show("an inherited method with the string", () => plain.rest());
show("the method", () => plain.close());
show("keys", () => Object.keys(plain));

const full = new Full();
show("the full one", () => [full.read(), full.advance(), full.rest(), positionOf(full), Object.keys(full)]);
full.close();
show("the full one closed", () => positionOf(full));

plain.position = 1;
plain.source = "xyz";
show("after stores", () => [plain.read(), plain.advance(), plain.rest(), Object.keys(plain)]);
