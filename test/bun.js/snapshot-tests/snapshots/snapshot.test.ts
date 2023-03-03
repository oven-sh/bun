function test1000000(arg1, arg218718132) {}

test("most types", () => {
  expect(test1000000).toMatchSnapshot("Function");
  expect(null).toMatchSnapshot("null");
  expect(() => {}).toMatchSnapshot("arrow function");
  expect(7).toMatchSnapshot("testing 7");
  expect(6).toMatchSnapshot("testing 4");
  expect(5).toMatchSnapshot("testing 5");
  expect(4).toMatchSnapshot("testing 4");
  expect(3).toMatchSnapshot();
  expect(1).toMatchSnapshot();
  expect(2).toMatchSnapshot();
  expect(9).toMatchSnapshot("testing 7");
  expect(8).toMatchSnapshot("testing 7");

  expect(undefined).toMatchSnapshot("undefined");
  expect("hello string").toMatchSnapshot("string");

  expect([[]]).toMatchSnapshot("Array with empty array");
  expect([[], [], [], []]).toMatchSnapshot("Array with multiple empty arrays");
  expect([1, 2, [3, 4], [4, [5, 6]], 8]).toMatchSnapshot("Array with nested arrays");

  // expect(new Buffer("")).toMatchSnapshot("Buffer");
  expect(new Date(0)).toMatchSnapshot("Date");
  expect(new Error("hello")).toMatchSnapshot("Error");
  expect(new Map()).toMatchSnapshot("empty map");
  expect(
    new Map([
      [1, "eight"],
      ["seven", "312390840812"],
    ]),
  ).toMatchSnapshot("Map");
  expect(new Set()).toMatchSnapshot("Set");
  expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])).toMatchSnapshot("Set2");
  expect(new WeakMap()).toMatchSnapshot("WeakMap");
  expect(new WeakSet()).toMatchSnapshot("WeakSet");
  expect(new Promise(() => {})).toMatchSnapshot("Promise");
  expect(new RegExp("hello")).toMatchSnapshot("RegExp");
  expect(new String("hello")).toMatchSnapshot("String");
  expect(new Number(7)).toMatchSnapshot("Number");
  expect(new Boolean(true)).toMatchSnapshot("Boolean");
  // expect(new Int8Array()).toMatchSnapshot("Int8Array");
  // expect(new Uint8Array()).toMatchSnapshot("Uint8Array");
  // expect(new Uint8ClampedArray()).toMatchSnapshot("Uint8ClampedArray");
  // expect(new Int16Array()).toMatchSnapshot("Int16Array");
  // expect(new Uint16Array()).toMatchSnapshot("Uint16Array");
  // expect(new Int32Array()).toMatchSnapshot("Int32Array");
  // expect(new Uint32Array()).toMatchSnapshot("Uint32Array");
  // expect(new Float32Array()).toMatchSnapshot("Float32Array");
  // expect(new Float64Array()).toMatchSnapshot("Float64Array");
  // expect(new ArrayBuffer(0)).toMatchSnapshot("ArrayBuffer");
  // expect(new DataView(new ArrayBuffer(0))).toMatchSnapshot("DataView");
  expect({}).toMatchSnapshot("Object");
  expect({ a: 1, b: 2 }).toMatchSnapshot("Object2");
  expect([]).toMatchSnapshot("Array");
  expect([1, 2, 3]).toMatchSnapshot("Array2");
  class A {
    a = 1;
    b = 2;

    constructor() {
      this.c = 3;
    }

    d() {
      return 4;
    }

    get e() {
      return 5;
    }

    set e(value) {
      this.f = value;
    }
  }

  expect(new A()).toMatchSnapshot("Class");
});
