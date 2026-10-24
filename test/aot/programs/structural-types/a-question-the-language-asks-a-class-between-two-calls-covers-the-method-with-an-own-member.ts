class Asked {
  static fire: () => void = () => {};
  static [Symbol.hasInstance](value: unknown): boolean {
    Asked.fire();
    return false;
  }
}

class Spreadable extends Array<number> {
  fire: () => void = () => {};
  get [Symbol.isConcatSpreadable](): boolean {
    this.fire();
    return true;
  }
}

class Special extends Array<number> {
  static fire: () => void = () => {};
  static get [Symbol.species](): ArrayConstructor {
    Special.fire();
    return Array;
  }
}

class Pattern {
  constructor(public fire: () => void) {}
  [Symbol.replace](text: string, replacement: string): string {
    this.fire();
    return replacement;
  }
  [Symbol.search](text: string): number {
    this.fire();
    return 0;
  }
}

class Tagged {
  constructor(public fire: () => void) {}
  get [Symbol.toStringTag](): string {
    this.fire();
    return "Tagged";
  }
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

class UnderInstanceof {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underInstanceof(p: UnderInstanceof, fire: () => void): string {
  const before = p.norm();
  Asked.fire = fire;
  const made = p instanceof Asked;
  return before + " " + String(made) + " " + p.norm();
}

drive("instanceof", new UnderInstanceof(), underInstanceof);

class UnderConcat {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underConcat(p: UnderConcat, fire: () => void): string {
  const before = p.norm();
  const list = new Spreadable();
  list.fire = fire;
  const made = [0].concat(list).length;
  return before + " " + String(made) + " " + p.norm();
}

drive("concat", new UnderConcat(), underConcat);

class UnderMap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underMap(p: UnderMap, fire: () => void): string {
  const before = p.norm();
  Special.fire = fire;
  const made = new Special().map(n => n).length;
  return before + " " + String(made) + " " + p.norm();
}

drive("map", new UnderMap(), underMap);

class UnderSlice {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSlice(p: UnderSlice, fire: () => void): string {
  const before = p.norm();
  Special.fire = fire;
  const made = new Special().slice().length;
  return before + " " + String(made) + " " + p.norm();
}

drive("slice", new UnderSlice(), underSlice);

class UnderReplace {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underReplace(p: UnderReplace, fire: () => void): string {
  const before = p.norm();
  const made = "text".replace(new Pattern(fire), "r");
  return before + " " + String(made) + " " + p.norm();
}

drive("replace", new UnderReplace(), underReplace);

class UnderSearch {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSearch(p: UnderSearch, fire: () => void): string {
  const before = p.norm();
  const made = "text".search(new Pattern(fire));
  return before + " " + String(made) + " " + p.norm();
}

drive("search", new UnderSearch(), underSearch);

class UnderTag {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underTag(p: UnderTag, fire: () => void): string {
  const before = p.norm();
  const made = Object.prototype.toString.call(new Tagged(fire));
  return before + " " + String(made) + " " + p.norm();
}

drive("the tag of an object", new UnderTag(), underTag);

export {};
