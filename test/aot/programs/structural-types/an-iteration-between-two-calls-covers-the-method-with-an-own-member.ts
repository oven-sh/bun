class Items {
  constructor(public fire: () => void) {}
  [Symbol.iterator](): Iterator<number> {
    this.fire();
    return [1, 2][Symbol.iterator]();
  }
}

class Steps implements IterableIterator<number> {
  at = 0;
  constructor(public fire: () => void) {}
  [Symbol.iterator](): this {
    return this;
  }
  next(): IteratorResult<number, undefined> {
    this.fire();
    return ++this.at <= 2 ? { done: false, value: this.at } : { done: true, value: undefined };
  }
}

class Closing implements IterableIterator<number> {
  constructor(public fire: () => void) {}
  [Symbol.iterator](): this {
    return this;
  }
  next(): IteratorResult<number, undefined> {
    return { done: false, value: 1 };
  }
  return(): IteratorResult<number, undefined> {
    this.fire();
    return { done: true, value: undefined };
  }
}

function* delegate(items: Items): Generator<number, void, unknown> {
  yield* items;
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

class UnderForOf {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underForOf(p: UnderForOf, fire: () => void): string {
  const before = p.norm();
  let made = 0;
  for (const n of new Items(fire)) made += n;
  return before + " " + String(made) + " " + p.norm();
}

drive("for-of", new UnderForOf(), underForOf);

class UnderSpread {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSpread(p: UnderSpread, fire: () => void): string {
  const before = p.norm();
  const made = [...new Items(fire)].length;
  return before + " " + String(made) + " " + p.norm();
}

drive("spread", new UnderSpread(), underSpread);

class UnderPattern {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underPattern(p: UnderPattern, fire: () => void): string {
  const before = p.norm();
  const [made] = new Items(fire);
  return before + " " + String(made) + " " + p.norm();
}

drive("an array pattern", new UnderPattern(), underPattern);

class UnderArrayFrom {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underArrayFrom(p: UnderArrayFrom, fire: () => void): string {
  const before = p.norm();
  const made = Array.from(new Items(fire)).length;
  return before + " " + String(made) + " " + p.norm();
}

drive("Array.from", new UnderArrayFrom(), underArrayFrom);

class UnderSet {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSet(p: UnderSet, fire: () => void): string {
  const before = p.norm();
  const made = new Set(new Items(fire)).size;
  return before + " " + String(made) + " " + p.norm();
}

drive("a new set", new UnderSet(), underSet);

class UnderSpreadArguments {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSpreadArguments(p: UnderSpreadArguments, fire: () => void): string {
  const before = p.norm();
  const made = Math.max(...new Items(fire));
  return before + " " + String(made) + " " + p.norm();
}

drive("spread arguments", new UnderSpreadArguments(), underSpreadArguments);

class UnderDelegation {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underDelegation(p: UnderDelegation, fire: () => void): string {
  const before = p.norm();
  const made = [...delegate(new Items(fire))].length;
  return before + " " + String(made) + " " + p.norm();
}

drive("yield*", new UnderDelegation(), underDelegation);

class UnderNext {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underNext(p: UnderNext, fire: () => void): string {
  const before = p.norm();
  let made = 0;
  for (const n of new Steps(fire)) made += n;
  return before + " " + String(made) + " " + p.norm();
}

drive("the next method", new UnderNext(), underNext);

class UnderReturn {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underReturn(p: UnderReturn, fire: () => void): string {
  const before = p.norm();
  let made = 0;
  for (const n of new Closing(fire)) {
    made += n;
    break;
  }
  return before + " " + String(made) + " " + p.norm();
}

drive("the return method", new UnderReturn(), underReturn);

export {};
