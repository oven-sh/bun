interface Narrow {
  x: number;
}

interface Wide {
  x: number;
  y: number;
}

interface Fixed {
  readonly x: number;
}

interface Maybe {
  x?: number;
}

class A {
  x = 1;
  y = 2;
}

class B {
  y = 20;
  x = 10;
}

function narrowAndWide(a: Narrow, b: Wide): string {
  const before = a.x;
  b.x = before + 100;
  return before + " " + a.x;
}

function fixedAndNarrow(a: Fixed, b: Narrow): string {
  const before = a.x;
  b.x = before + 100;
  return before + " " + a.x;
}

function twoClasses(a: A, b: B): string {
  const before = a.x;
  b.x = before + 100;
  const between = a.x;
  a.y = -1;
  return before + " " + between + " " + b.y;
}

function classAndInterface(a: A, b: Wide): string {
  const before = a.y;
  b.y = before + 100;
  return before + " " + a.y;
}

function fullAndMaybe(a: Narrow, b: Maybe): string {
  const before = a.x;
  delete b.x;
  return before + " " + a.x + " " + ("x" in a);
}

function loopOverTwoViews(a: Fixed, b: Narrow): number {
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    sum += a.x;
    b.x++;
  }
  return sum;
}

function loopOverTwoClasses(a: A, b: B): number {
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    sum += a.x;
    b.x += 2;
  }
  return sum;
}

function elementAndParameter(list: Narrow[], b: Wide): string {
  const before = list[0].x;
  b.x = before + 100;
  return before + " " + list[0].x;
}

class Holder {
  constructor(public inner: A) {}
  fieldAndParameter(b: B): string {
    const before = this.inner.x;
    b.x = before + 100;
    return before + " " + this.inner.x;
  }
}

function apart(): void {
  console.log("two objects, narrow and wide: " + narrowAndWide({ x: 1 }, { x: 2, y: 3 }));
  console.log("two objects, fixed and narrow: " + fixedAndNarrow({ x: 1 }, { x: 2 }));
  console.log("two objects, two classes: " + twoClasses(new A(), new B()));
  console.log("two objects, class and interface: " + classAndInterface(new A(), { x: 0, y: 0 }));
  console.log("two objects, full and maybe: " + fullAndMaybe({ x: 1 }, { x: 2 }));
  console.log("two objects, a loop: " + loopOverTwoViews({ x: 1 }, { x: 1 }));
  console.log("two objects, a loop over classes: " + loopOverTwoClasses(new A(), new B()));
}

for (let i = 0; i < 500; i++) {
  narrowAndWide({ x: 1 }, { x: 2, y: 3 });
  twoClasses(new A(), new B());
}
apart();

const literal = { x: 1, y: 2 };
console.log("one literal, narrow and wide: " + narrowAndWide(literal, literal));
console.log("one literal, fixed and narrow: " + fixedAndNarrow(literal, literal));
console.log("one literal, two classes: " + twoClasses(literal, literal));
console.log("one literal, full and maybe: " + fullAndMaybe(literal, literal));

const a = new A();
console.log("one A, two classes: " + twoClasses(a, a));
console.log("one A, class and interface: " + classAndInterface(a, a));
console.log("one A, narrow and wide: " + narrowAndWide(a, a));
console.log("one A, a loop: " + loopOverTwoViews(a, a));
console.log("one A, a loop over classes: " + loopOverTwoClasses(a, a));

const b = new B();
console.log("one B, two classes: " + twoClasses(b, b));
console.log("one B, class and interface: " + classAndInterface(b, b));
console.log("one B, a loop over classes: " + loopOverTwoClasses(b, b));
console.log("one B, element and parameter: " + elementAndParameter([b], b));
console.log("one B, field and parameter: " + new Holder(b).fieldAndParameter(b));
console.log("one A, field and parameter: " + new Holder(a).fieldAndParameter(a));

apart();

export {};
