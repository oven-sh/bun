export function foo1(text: string): {
  Foo: string;
  Bar: string;
};

export function foo2(
  text: string
): {
  Foo: string;
  Bar: string;
} {
  return bar();
}

export function foo3(
  text: string
): { Foo: string; Bar: string; } {
  return bar();
}
