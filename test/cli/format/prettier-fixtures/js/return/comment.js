function f() {
  return /* a */;
}

function f() {
  return // a
  ;
}

function f() {
  return // a
  /* b */;
}

function f() {
  return /* a */
  // b
  ;
}

function x() {
  return func2
      //comment
      .bar();
  return func2
      //comment
      ?.bar();
}

function f() {
  return (
    foo
      // comment
      .bar()
  );
  return (
    foo
      // comment
      ?.bar()
  );
}

fn(function f() {
  return (
    foo
      // comment
      .bar()
  );
  return (
    foo
      // comment
      ?.bar()
  );
});
