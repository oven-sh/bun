const fn1 = a => 3;
const fn2 = a => b => 3;
const fn3 = a => b => c => 3;
const fn4 = a => b => c => d => 3;
const fn5 = a => b => c => d => e => 3;
const fn6 = a => b => c => d => e => g => 3;
const fn7 = a => b => c => d => e => g => f => 3;

const fn8 = a => ({ foo: bar, bar: baz, baz: foo });
const fn9 = a => b => ({ foo: bar, bar: baz, baz: foo });
const fn10 = a => b => c => ({ foo: bar, bar: baz, baz: foo });
const fn11 = a => b => c => d => ({ foo: bar, bar: baz, baz: foo });
const fn12 = a => b => c => d => e => ({ foo: bar, bar: baz, baz: foo });
const fn13 = a => b => c => d => e => g => ({ foo: bar, bar: baz, baz: foo });
const fn14 = a => b => c => d => e => g => f => ({ foo: bar, bar: baz, baz: foo });

const curryTest =
    (argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) =>
      ({
        foo: argument1,
        bar: argument2,
      });

let curryTest2 =
    (argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => {
      const foo = "foo";
      return foo + "bar";
    };

curryTest2 =
    (argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => {
      const foo = "foo";
      return foo + "bar";
    };

throw (argument1) =>
(argument2) =>
(argument3) =>
(argument4) =>
(argument5) =>
(argument6) =>
(argument7) =>
(argument8) =>
(argument9) =>
(argument10) =>
(argument11) =>
(argument12) => {
  const foo = "foo";
  return foo + "bar";
};

foo((argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => 3);

foo((argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => ({
        foo: bar,
        bar: baz,
        baz: foo
    }));

foo(
    (argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => {
      const foo = "foo";
      return foo + "bar";
    }
);

((argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => 3)(3);

bar(
  foo(
    (argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => ({
      foo: bar,
      bar: baz,
    })
  )
);

const baaaz = (aaaaa1, bbbbb1) => (aaaaa2, bbbbb2) => (aaaaa3, bbbbb3) => (aaaaa4, bbbbb4) => ({
  foo: bar
});

new Fooooooooooooooooooooooooooooooooooooooooooooooooooo(
  (action) =>
    (next) =>
    (next) =>
    (next) =>
    (next) =>
    (next) =>
    (next) =>
    dispatch(action)
);

foo?.Fooooooooooooooooooooooooooooooooooooooooooooooooooo(
  (action) =>
    (next) =>
    (next) =>
    (next) =>
    (next) =>
    (next) =>
    (next) =>
    dispatch(action)
);

foo(action => action => action);

import( (argument1) =>
    (argument2) =>
    (argument3) =>
    (argument4) =>
    (argument5) =>
    (argument6) =>
    (argument7) =>
    (argument8) =>
    (argument9) =>
    (argument10) =>
    (argument11) =>
    (argument12) => {
      const foo = "foo";
      return foo + "bar";
    });
