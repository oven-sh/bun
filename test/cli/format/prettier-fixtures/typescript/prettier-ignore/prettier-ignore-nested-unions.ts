export type a =
  // foo
  | foo1&foo2
  // bar
  | bar1&bar2
  // prettier-ignore
  | (
    | aaaaaaaaaaaaa&1
    // b
    | bbbbbbbbbbbbb&2
  )
  // baz
  | baz1&baz2;

export type b =
  // foo
  | foo1&foo2
  // bar
  | bar1&bar2
  | (
    // prettier-ignore
    | aaaaaaaaaaaaa&1
    // b
    | bbbbbbbbbbbbb&2
  )
  // baz
  | baz1&baz2;
