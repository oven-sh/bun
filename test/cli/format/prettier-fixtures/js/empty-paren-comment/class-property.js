class Foo {
  f(/* ... */) {}
  f() /* ... */ {}
  f = (/* ... */) => {};
  static f(/* ... */) {};
  static f = (/* ... */) => {};
  static f = function(/* ... */) {};
  static f = function f(/* ... */) {};
}
