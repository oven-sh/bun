export type a =
  // foo
  | foo1&foo2
  // bar
  | bar1&bar2
  // prettier-ignore
  | qux1&qux2;

export type b =
  // foo
  | foo1&foo2
  // bar
  | bar1&bar2
  // prettier-ignore
  | qux1&qux2
  // baz
  | baz1&baz2;

export type c =
  // prettier-ignore
  | foo1&foo2
  // bar
  | bar1&bar2
  // qux
  | qux1&qux2;
