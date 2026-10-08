interface FooConstructor {
  new (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number
  ): Foo;
}

interface BarConstructor {
  new <A, B, C>(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number
  ): Foo;
}

type BazConstructor = {
  new (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number
  ): Foo;
}


interface ConstructorBigGenerics {
  // comment
  new <AAAAAAAAAAAAAAAAAAAAAAAA, AAAAAAAAAAAAAAAAAAAAAAAA, AAAAAAAAAAAAAAAAAAAAAAAA>(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number
  ): Foo;
}

interface ConstructorInline {
  // https://github.com/prettier/prettier/issues/2163
  (i): any;
}

interface TimerConstructor {
  // Line-splitting comment
  new (interval: number, callback: (handler: Timer) => void): Timer;
}
