type Foo = (
  | "thing1" // Comment1
  | "thing2" // Comment2
)[]; // Final comment1

type Foo = (
  | "thing1" // Comment1
  | "thing2" // Comment2
) & Bar; // Final comment2

type Foo = (
  | "thing1" // Comment1
  | "thing2" // Comment2
) | Bar; // Final comment2
