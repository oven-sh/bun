class Text {
  constructor(public fire: () => void) {}
  toString(): string {
    this.fire();
    return "text";
  }
}

class Value {
  constructor(public fire: () => void) {}
  valueOf(): number {
    this.fire();
    return 1;
  }
}

class Primitive {
  constructor(public fire: () => void) {}
  [Symbol.toPrimitive](hint: string): string {
    this.fire();
    return hint;
  }
}

class Json {
  constructor(public fire: () => void) {}
  toJSON(): string {
    this.fire();
    return "json";
  }
}

const nothing = (): void => {};

function drive<T extends { norm(): number }>(label: string, p: T, holder: { norm(): number }, run: (p: T, fire: () => void) => string): void {
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += run(p, nothing).length;
  const written = holder.norm;
  const change = (): void => {
    holder.norm = () => -1;
  };
  const parts = [String(warm), run(p, nothing), run(p, change), run(p, nothing)];
  holder.norm = written;
  parts.push(run(p, nothing));
  console.log(label + ": " + parts.join(" | "));
}

class UnderTemplate {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underTemplate(p: UnderTemplate, fire: () => void): string {
  const before = p.norm();
  const made = `${new Text(fire)}`;
  return before + " " + String(made) + " " + p.norm();
}

drive("a template", new UnderTemplate(), UnderTemplate.prototype, underTemplate);

class UnderPlus {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underPlus(p: UnderPlus, fire: () => void): string {
  const before = p.norm();
  const made = "" + new Text(fire);
  return before + " " + String(made) + " " + p.norm();
}

drive("a plus with a string", new UnderPlus(), UnderPlus.prototype, underPlus);

class UnderUnaryPlus {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underUnaryPlus(p: UnderUnaryPlus, fire: () => void): string {
  const before = p.norm();
  const made = +new Value(fire);
  return before + " " + String(made) + " " + p.norm();
}

drive("a unary plus", new UnderUnaryPlus(), UnderUnaryPlus.prototype, underUnaryPlus);

class UnderComparison {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underComparison(p: UnderComparison, fire: () => void): string {
  const before = p.norm();
  const made = new Value(fire) < new Value(fire);
  return before + " " + String(made) + " " + p.norm();
}

drive("a comparison", new UnderComparison(), UnderComparison.prototype, underComparison);

class UnderString {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underString(p: UnderString, fire: () => void): string {
  const before = p.norm();
  const made = String(new Text(fire));
  return before + " " + String(made) + " " + p.norm();
}

drive("String", new UnderString(), UnderString.prototype, underString);

class UnderNumber {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underNumber(p: UnderNumber, fire: () => void): string {
  const before = p.norm();
  const made = Number(new Value(fire));
  return before + " " + String(made) + " " + p.norm();
}

drive("Number", new UnderNumber(), UnderNumber.prototype, underNumber);

class UnderJoin {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underJoin(p: UnderJoin, fire: () => void): string {
  const before = p.norm();
  const made = [new Text(fire)].join();
  return before + " " + String(made) + " " + p.norm();
}

drive("join", new UnderJoin(), UnderJoin.prototype, underJoin);

class UnderJson {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underJson(p: UnderJson, fire: () => void): string {
  const before = p.norm();
  const made = JSON.stringify(new Json(fire));
  return before + " " + String(made) + " " + p.norm();
}

drive("JSON.stringify", new UnderJson(), UnderJson.prototype, underJson);

class UnderToPrimitive {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underToPrimitive(p: UnderToPrimitive, fire: () => void): string {
  const before = p.norm();
  const made = `${new Primitive(fire)}`;
  return before + " " + String(made) + " " + p.norm();
}

drive("Symbol.toPrimitive", new UnderToPrimitive(), UnderToPrimitive.prototype, underToPrimitive);

export {};
