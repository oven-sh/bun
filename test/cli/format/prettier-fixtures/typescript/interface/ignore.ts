interface Interface {
  // prettier-ignore
  prop: type
  // prettier-ignore
  prop: type;
  prop: type;
}

// Last element
interface Interface {
  // prettier-ignore
  prop: type
  prop: type
}

interface foo extends bar {
  // prettier-ignore
  f(): void;
  // prettier-ignore
  g(): void;
  h(): void;
}

interface T<T> {
  // prettier-ignore
  new<T>(): T<T>;
  new<T>(): T<T>;
}

interface I {
  // prettier-ignore
  x: y;
}

interface I {
  // prettier-ignore
  x: y,
}

interface I {
  // prettier-ignore
  x: y
}

interface I {
  // prettier-ignore
  x: y;
  y: x
}

interface I {
  // prettier-ignore
  x: y,
  y: x
}

interface I {
  // prettier-ignore
  x: y
  y: x
}

interface I {
  // prettier-ignore
  (): void;
}

interface I {
  // prettier-ignore
  (): void,
}

interface I {
  // prettier-ignore
  (): void
}

interface I {
  // prettier-ignore
  foo(): void;
}

interface I {
  // prettier-ignore
  foo(): void,
}

interface I {
  // prettier-ignore
  foo(): void
}

interface I {
  // prettier-ignore
  new ();
}

interface I {
  // prettier-ignore
  new (),
}

interface I {
  // prettier-ignore
  new ()
}
