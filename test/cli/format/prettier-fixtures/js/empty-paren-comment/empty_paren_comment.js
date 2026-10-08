let f1 = (/* ... */) => {}
(function (/* ... */) {})(/* ... */)
function f2(/* ... */) {}

const obj = {
  f(/* ... */) {},
  f: (/* ... */) => {},
  f: function(/* ... */) {},
  f: function f(/* ... */) {}
}

f(/* ... */);
f(a, /* ... */);
f(a, /* ... */ b);
f(/* ... */ a, b);

let f3 = () => import(a /* ... */);
let f4 = () => doThing(a, /* ... */ b);
