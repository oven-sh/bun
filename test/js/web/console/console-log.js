console.log({ a: "" });
console.log("Hello World!");
console.log(0);
console.log(-0);
console.log(123);
console.log(-123);
console.log(123.567);
console.log(-123.567);
console.log(true);
console.log(false);
console.log(null);
console.log(undefined);
console.log(Infinity);
console.log(-Infinity);
console.log(Symbol("Symbol Description"));
console.log(new Date(Math.pow(2, 34) * 56));
console.log([123, 456, 789]);
console.log({ name: "foo" });
console.log({ a: 123, b: 456, c: 789 });
console.log(Number.MAX_VALUE);
console.log(Number.MIN_VALUE);
console.log(899999999999999918767229449717619953810131273674690656206848);
console.log(0.299999999999999988896);
console.log(0.29999999999999993);
console.log({
  a: {
    b: {
      c: 123,
    },
    bacon: true,
  },
  name: "bar",
});

console.log(new Promise(() => {}));

class Foo {}
class FooWithProp {
  a = 1;
}

console.log({});
console.log(() => {});
console.log(function () {});
console.log(Foo);
console.log(class {});
console.log(new Foo());
console.log(new FooWithProp());
console.log(function foooo() {});

console.log(/FooRegex/);

console.error("uh oh");
console.time("Check");

console.log("Is it a bug or a feature that formatting numbers like %d is colored", 123);
//console.log(globalThis);

console.log("String %s should be 2nd word, 456 == %s and percent s %s == %s", "123", "456", "%s", "What", "okay");

console.log("%s%s without space should work", "123", "456");

const infinteLoop = {
  foo: {
    name: "baz",
  },
  bar: {},
};

infinteLoop.bar = infinteLoop;
console.log(infinteLoop, "am");

console.log(new Array(4).fill({}));
const nestedObject = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            name: "Deeply nested object",
          },
        },
      },
    },
  },
};
console.log(nestedObject);
console.dir({ 1: { 2: { 3: 3 } } }, { depth: 0, colors: false }, "Some ignored arg");
console.dir({ 1: { 2: { 3: 3 } } }, { depth: -1, colors: false }, "Some ignored arg");
console.dir({ 1: { 2: { 3: 3 } } }, { depth: 1.2, colors: false }, "Some ignored arg");
console.dir({ 1: { 2: { 3: 3 } } }, { depth: Infinity, colors: false }, "Some ignored arg");
console.dir({ 1: { 2: { 3: 3 } } }, { depth: -Infinity, colors: false }, "Some ignored arg");
console.dir({ 1: { 2: { 3: 3 } } }, { depth: NaN, colors: false }, "Some ignored arg");
const set = new Set([1, "123", { a: [], str: "123123132", nr: 3453 }]);
console.log(set.keys());
console.log(set.values());
console.log(new Set().keys(), new Set().values());
const m = new Map([
  ["key", { a: [], str: "123123132", nr: 3453 }],
  ["key_2", { b: "test" }],
]);
console.log(m.keys());
console.log(m.values());
console.log(new Map().keys(), new Map().values());
class NestedClass {
  a = 1;
  b = 2;
  foo = new FooWithProp();
  test() {
    return 3;
  }
}
console.log(new NestedClass());

const objectWithStringTag = {
  [Symbol.toStringTag]: "myCustomName",
};
console.log(objectWithStringTag);

console.log({ length: 4, 0: 1, 1: 2, 2: 3, 3: 4 });
console.log([1, 2, 3]);
function hole(array, ...ranges) {
  var result = new Array(array.length);
  for (let index of ranges) {
    result[index] = array[index];
  }

  return result;
}
console.log(hole([1, 2, 3], 1));
console.log(hole([1, 2, 3], 0, 1));
console.log(hole([1, 2, 3], 0, 1, 2));
console.log(hole([1, 2, 3], 2));
console.log(hole([1, 2, 3], 0));

{
  const overriddenArray = [1, 2, 3, 4];
  overriddenArray.length = 42;
  delete overriddenArray[2];
  console.log(overriddenArray);
}

{
  const overriddenArray = [1, 2, 4];
  overriddenArray.length = 42;
  delete overriddenArray[1];
  console.log(overriddenArray);
}

{
  const overriddenArray = new Array(42);
  delete overriddenArray[1];
  console.log(overriddenArray);
}

{
  // huge holey array
  const overriddenArray = new Array(1024);
  console.log(overriddenArray);
}

{
  // array too large to have an inline storage capacity
  const overriddenArray = new Array(1024);
  for (let i = 0; i < overriddenArray.length; i++) {
    overriddenArray[i] = "i" + i;
  }
  delete overriddenArray[1];
  delete overriddenArray[876];
  console.log(overriddenArray);
}

// ensure length property is shown
{
  console.log({ a: 42, length: 0 });
  console.log({ [1]: 42, length: 1 });
}

// TODO: handle DerivedArray
// It appears to not be set and I don't know why.

console.log({ "": "" });

{
  // proxy
  const proxy = Proxy.revocable(
    { hello: 2 },
    {
      get(target, prop, receiver) {
        console.log("FAILED: GET", prop);
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        console.log("FAILED: SET", prop, value);
        return Reflect.set(target, prop, value, receiver);
      },
    },
  );
  console.log(proxy.proxy);
  proxy.revoke();
  console.log(proxy.proxy);
}

console.log([[[[Array(1000).fill(4)]]]]);

{
  // proxy custom inspect
  const proxy = new Proxy(
    {
      [Bun.inspect.custom]: () => "custom inspect",
    },
    {},
  );
  console.log(proxy);
}

console.log("| %i | %i | %i | %i | %i | %i |", 0, 0.2, 132.51, -42.52, 41278885384321884328431, -0.0000000000085);
console.log("| %i | %i | %i | %i | %i | %i |", NaN, Infinity, -Infinity, -0, {}, Symbol.for("magic"));

console.log("| %d | %d | %d | %d | %d | %d |", 0, 0.2, 132.51, -42.52, -41278885384321884328431, 0.0000000000085);
console.log("| %d | %d | %d | %d | %d | %d |", NaN, Infinity, -Infinity, -0, {}, Symbol.for("magic"));

console.log("%d", { [Symbol.toPrimitive]: () => 0.000000000005 });

class Frac {
  constructor(num, den) {
    this.num = num;
    this.den = den;
  }

  [Symbol.toPrimitive]() {
    return this.num / this.den;
  }
}

console.log("| %f | %f | %f | %f | %f | %f |", 0, 0.2, 132.51, -42.52, 41278885384321884328431, -0.0000000000085);
console.log("| %f | %f | %f | %f | %f | %f |", NaN, Infinity, -Infinity, -0, {}, Symbol.for("magic"));

console.log("%f | %f", new Frac(1, 2), 0.005);

console.log("%d", { [Symbol.toPrimitive]: () => 0 });
console.log("%f", 504252);
console.log("%f", -491952);
console.log("%f", 8589934592);
console.log("%f", -8589934592);
console.log("%f", 0.0005);
console.log("%f", -0.0005);
console.log("%f %d", Number.MAX_VALUE, Number.MAX_VALUE);
console.log("%f %d", -Number.MAX_VALUE, Number.MAX_VALUE);
console.log("%f %d", Number.MIN_VALUE, Number.MIN_VALUE);
console.log("%f %d", -Number.MIN_VALUE, Number.MIN_VALUE);

console.log("%f %d", Number.MIN_VALUE * 1.2, Number.MIN_VALUE * 1.5);
console.log("%f %d", -Number.MIN_VALUE * 1.2, Number.MIN_VALUE * 1.2);

console.log("%f", 0.30000000000000004);

console.log("Hello %cWorld", "color: red", 123);
console.log("Hello %vWorld", 123);

console.log("Hello %i %i", [1, 2, 3, 4]);
console.log("Hello %i %", [1, 2, 3, 4], 1);
console.log("Hello %i %j", [1, 2, 3, 4], 1);
console.log("Hello \\%i %i,", 5, 6);
console.log("Hello %%i %i", 5, 6);

// doesn't go out of bounds when printing
console.log("%%d", 1);
