class Getter {
  constructor(public fire: () => void) {}
  get value(): number {
    this.fire();
    return 1;
  }
}

class Setter {
  kept = 0;
  constructor(public fire: () => void) {}
  get value(): number {
    return this.kept;
  }
  set value(next: number) {
    this.fire();
    this.kept = next;
  }
}

class Plain {
  value = 1;
  extra?: number = 2;
}

function literal(fire: () => void): { value: number } {
  return {
    get value() {
      fire();
      return 1;
    },
  };
}

function redefined(fire: () => void): Plain {
  const made = new Plain();
  Object.defineProperty(made, "value", {
    get() {
      fire();
      return 1;
    },
    enumerable: true,
  });
  return made;
}

function firstIsAGetter(fire: () => void): number[] {
  const list = [1, 2];
  Object.defineProperty(list, 0, {
    get() {
      fire();
      return 1;
    },
  });
  return list;
}

const nothing = (): void => {};

function drive<T extends { norm(): number }>(label: string, p: T, run: (p: T, fire: () => void) => string): void {
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += run(p, nothing).length;
  const change = (): void => {
    p.norm = () => -1;
  };
  const parts = [String(warm), run(p, nothing), run(p, change), run(p, nothing)];
  Reflect.deleteProperty(p, "norm");
  parts.push(run(p, nothing));
  console.log(label + ": " + parts.join(" | "));
}

class UnderGetter {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underGetter(p: UnderGetter, fire: () => void): string {
  const before = p.norm();
  const made = new Getter(fire).value;
  return before + " " + String(made) + " " + p.norm();
}

drive("a getter of a class", new UnderGetter(), underGetter);

class UnderSetter {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSetter(p: UnderSetter, fire: () => void): string {
  const before = p.norm();
  const made = (new Setter(fire).value = 5);
  return before + " " + String(made) + " " + p.norm();
}

drive("a setter of a class", new UnderSetter(), underSetter);

class UnderIncrement {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underIncrement(p: UnderIncrement, fire: () => void): string {
  const before = p.norm();
  const made = new Setter(fire).value++;
  return before + " " + String(made) + " " + p.norm();
}

drive("an increment of an accessor", new UnderIncrement(), underIncrement);

class UnderLiteralGetter {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underLiteralGetter(p: UnderLiteralGetter, fire: () => void): string {
  const before = p.norm();
  const made = literal(fire).value;
  return before + " " + String(made) + " " + p.norm();
}

drive("a getter of a literal", new UnderLiteralGetter(), underLiteralGetter);

class UnderRedefinedField {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underRedefinedField(p: UnderRedefinedField, fire: () => void): string {
  const before = p.norm();
  const made = redefined(fire).value;
  return before + " " + String(made) + " " + p.norm();
}

drive("a field redefined as a getter", new UnderRedefinedField(), underRedefinedField);

class UnderObjectPattern {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underObjectPattern(p: UnderObjectPattern, fire: () => void): string {
  const before = p.norm();
  const { value: made } = redefined(fire);
  return before + " " + String(made) + " " + p.norm();
}

drive("an object pattern", new UnderObjectPattern(), underObjectPattern);

class UnderObjectSpread {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underObjectSpread(p: UnderObjectSpread, fire: () => void): string {
  const before = p.norm();
  const made = { ...redefined(fire) }.value;
  return before + " " + String(made) + " " + p.norm();
}

drive("an object spread", new UnderObjectSpread(), underObjectSpread);

class UnderAssign {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underAssign(p: UnderAssign, fire: () => void): string {
  const before = p.norm();
  const made = Object.assign({ value: 0 }, literal(fire)).value;
  return before + " " + String(made) + " " + p.norm();
}

drive("Object.assign", new UnderAssign(), underAssign);

class UnderValues {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underValues(p: UnderValues, fire: () => void): string {
  const before = p.norm();
  const made = Object.values(redefined(fire)).length;
  return before + " " + String(made) + " " + p.norm();
}

drive("Object.values", new UnderValues(), underValues);

class UnderElement {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underElement(p: UnderElement, fire: () => void): string {
  const before = p.norm();
  const made = firstIsAGetter(fire)[0];
  return before + " " + String(made) + " " + p.norm();
}

drive("an element that is a getter", new UnderElement(), underElement);

export {};
