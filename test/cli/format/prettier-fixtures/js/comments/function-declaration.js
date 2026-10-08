function a(/* comment */) {} // comment
function b() {} // comment
function c(/* comment */ argA, argB, argC) {} // comment
call((/*object*/ row) => {});
KEYPAD_NUMBERS.map(num => ( // Buttons 0-9
  <div />
));

function f1 /* f */() {}
function f2 (/* args */) {}
function f3 () /* returns */ {}
function f4 /* f */(/* args */) /* returns */ {}

function f5 /* f */(/* a */ a) {}
function f6 /* f */(a /* a */) {}
function f7 /* f */(/* a */ a) /* returns */ {}

const obj = {
  f1 /* f */() {},
  f2 (/* args */) {},
  f3 () /* returns */ {},
  f4 /* f */(/* args */) /* returns */ {},
};

(function f /* f */() {})();
(function f (/* args */) {})();
(function f () /* returns */ {})();
(function f /* f */(/* args */) /* returns */ {})();

class C1 {
  f/* f */() {}
}
class C2 {
  f(/* args */) {}
}
class C3 {
  f() /* returns */ {}
}
class C4 {
  f/* f */(/* args */) /* returns */ {}
}

function foo1() 
// this is a function
{
  return 42
}

function foo2() // this is a function
{
  return 42
}

function foo3() { // this is a function
  return 42
}

function foo4() {
  // this is a function
  return 42;
}
