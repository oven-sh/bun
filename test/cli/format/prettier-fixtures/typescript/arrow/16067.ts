const foo1 = 
  // comment
  <T>() => () => 1;

const foo2 = 
  // comment
  () => () => 1;

const foo3 = 
  // comment
  <T>() => 1;

foo(
  // comment
  <T>() => () => 1,
);

a ||
  // comment
  (<T>() => () => 1);

void
  // comment
  (<T>() => () => 1);

cond ?
  // comment
  <T>() => () => 1
  :
  // comment
  <T>() => () => 1;

foo4 = 
  // comment
  <T>() => () => 1;
