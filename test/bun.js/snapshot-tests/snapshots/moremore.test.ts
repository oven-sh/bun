class Number2 extends Number {
  constructor(value) {
    super(value);
  }
}
class Number3 extends Number2 {
  constructor(value) {
    super(value);
  }
}

class Boolean2 extends Boolean {
  constructor(value) {
    super(value);
  }
}

class Boolean3 extends Boolean2 {
  constructor(value) {
    super(value);
  }

  false = true;

  helloBoolean3() {
    return "true";
  }
}

test("test snapshots with Boolean and Number", () => {
  expect(1).toMatchSnapshot();
  expect(NaN).toMatchSnapshot();
  expect(Infinity).toMatchSnapshot();
  expect(-Infinity).toMatchSnapshot();
  expect(0).toMatchSnapshot();
  expect(-0).toMatchSnapshot();
  expect(1.1).toMatchSnapshot();
  expect(-1.1).toMatchSnapshot();
  expect(undefined).toMatchSnapshot();
  expect(null).toMatchSnapshot();
  expect("hello").toMatchSnapshot();
  expect("").toMatchSnapshot();

  expect(new Number(1)).toMatchSnapshot();
  expect(new Number2(1)).toMatchSnapshot();
  expect(new Number3(1)).toMatchSnapshot();
  expect(123348923.2341281).toMatchSnapshot();
  expect(false).toMatchSnapshot();
  expect(true).toMatchSnapshot();
  expect(new Boolean(false)).toMatchSnapshot();
  expect(new Boolean(true)).toMatchSnapshot();
  expect(new Boolean2(true)).toMatchSnapshot();
  expect(new Boolean2(false)).toMatchSnapshot();
  expect(new Boolean3(true)).toMatchSnapshot();
  expect(new Boolean3(false)).toMatchSnapshot();
});
