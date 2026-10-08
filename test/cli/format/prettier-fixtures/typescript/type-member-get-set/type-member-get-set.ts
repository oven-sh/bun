interface Foo {
  get foo(): string;
  set bar(v);
}

type Foo = {
  get foo(): string;
  set bar(v);
}

interface Foo {
  set bar(foo: string);
}
