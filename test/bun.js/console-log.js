console.log("Hello World!");
console.log(123);
console.log(-123);
console.log(123.567);
console.log(-123.567);
console.log(true);
console.log(false);
console.log(null);
console.log(undefined);
console.log(Symbol("Symbol Description"));
console.log(new Date(2021, 12, 30, 666, 777, 888, 999));
console.log([123, 456, 789]);
console.log({ a: 123, b: 456, c: 789 });
console.log({
  a: {
    b: {
      c: 123,
    },
    bacon: true,
  },
});

console.log(new Promise(() => {}));

class Foo {}

console.log(() => {});
console.log(Foo);
console.log(new Foo());
console.log(function foooo() {});

console.log(/FooRegex/);

console.error("uh oh");
console.time("Check");

console.log(
  "Is it a bug or a feature that formatting numbers like %d is colored",
  123
);
console.log(globalThis);

console.log(
  "String %s should be 2nd word, 456 == %s and percent s %s == %s",
  "123",
  "456",
  "%s",
  "What",
  "okay"
);

const infinteLoop = {
  foo: {},
  bar: {},
};

infinteLoop.bar = infinteLoop;
console.log(infinteLoop, "am");

console.log(new Array(4).fill({}))
