function x() {
  throw func2
      //comment
      .bar();
}
 
function f() {
  throw (
    foo
      // comment
      .bar()
  );
}
 
fn(function f() {
  throw (
    foo
      // comment
      .bar()
  );
});
