test("top level", () => {
  expect({ a: 1 }).toMatchSnapshot();
});
test("several in one test", () => {
  expect(1).toMatchSnapshot();
  expect("two").toMatchSnapshot();
  expect([3]).toMatchSnapshot();
});
describe("outer", () => {
  test("one level", () => {
    expect({ level: 1 }).toMatchSnapshot();
  });
  describe("inner", () => {
    test("two levels", () => {
      expect({ level: 2 }).toMatchSnapshot();
      expect({ level: 2, again: true }).toMatchSnapshot();
    });
    describe("innermost", () => {
      it("three levels", () => {
        expect({ level: 3 }).toMatchSnapshot();
      });
    });
  });
  test("after the inner block", () => {
    expect("after").toMatchSnapshot();
  });
});
describe("hints", () => {
  test("a hint", () => {
    expect(1).toMatchSnapshot("first hint");
    expect(2).toMatchSnapshot("second hint");
  });
  test("the same hint twice", () => {
    expect(1).toMatchSnapshot("same");
    expect(2).toMatchSnapshot("same");
    expect(3).toMatchSnapshot();
    expect(4).toMatchSnapshot("same");
    expect(5).toMatchSnapshot();
  });
  test("hint with properties", () => {
    expect({ id: 7, name: "n" }).toMatchSnapshot({ id: expect.any(Number) }, "with props");
  });
  test("hint with odd characters", () => {
    expect(1).toMatchSnapshot("back`tick");
    expect(2).toMatchSnapshot("dollar ${brace}");
    expect(3).toMatchSnapshot("back\\slash");
    expect(4).toMatchSnapshot("a > b");
    expect(5).toMatchSnapshot("colon: here");
    expect(6).toMatchSnapshot("");
  });
});
describe("same name twice", () => {
  test("dup", () => {
    expect("first").toMatchSnapshot();
  });
  test("dup", () => {
    expect("second").toMatchSnapshot();
  });
});
describe("odd characters", () => {
  test("back`tick", () => {
    expect(1).toMatchSnapshot();
  });
  test("two ``backticks``", () => {
    expect(1).toMatchSnapshot();
  });
  test("dollar $ sign", () => {
    expect(1).toMatchSnapshot();
  });
  test("template ${expr} here", () => {
    expect(1).toMatchSnapshot();
  });
  test("dollar brace alone ${", () => {
    expect(1).toMatchSnapshot();
  });
  test("back\\slash", () => {
    expect(1).toMatchSnapshot();
  });
  test("two \\\\ backslashes", () => {
    expect(1).toMatchSnapshot();
  });
  test(`single 'quotes' and "double"`, () => {
    expect(1).toMatchSnapshot();
  });
  test(`new
line`, () => {
    expect(1).toMatchSnapshot();
  });
  test("tab\there", () => {
    expect(1).toMatchSnapshot();
  });
  test("unicode é ü 日本語 \uD83D\uDE00", () => {
    expect(1).toMatchSnapshot();
  });
  test("control \x01 \x1B[31m char", () => {
    expect(1).toMatchSnapshot();
  });
  test("  leading and trailing spaces  ", () => {
    expect(1).toMatchSnapshot();
  });
  test("a > b", () => {
    expect(1).toMatchSnapshot();
  });
  test("ends with a number 1", () => {
    expect(1).toMatchSnapshot();
    expect(2).toMatchSnapshot();
  });
  test("ends with a number", () => {
    expect("x").toMatchSnapshot();
  });
  test("] = `", () => {
    expect(1).toMatchSnapshot();
  });
  test("", () => {
    expect("empty name").toMatchSnapshot();
  });
  test("\u2028 line separator", () => {
    expect(1).toMatchSnapshot();
  });
  test("nul \x00 char", () => {
    expect(1).toMatchSnapshot();
  });
});
describe("", () => {
  test("in a describe without a name", () => {
    expect(1).toMatchSnapshot();
  });
});
describe("each", () => {
  test.each([1, 2, 3])("number %i", n => {
    expect(n * 2).toMatchSnapshot();
  });
  test.each([
    ["a", 1],
    ["b", 2],
  ])("pair %s %d", (s, n) => {
    expect({ s, n }).toMatchSnapshot();
  });
  test.each([
    { name: "x", v: 1 },
    { name: "y", v: 2 },
  ])("object $name has $v", o => {
    expect(o).toMatchSnapshot();
  });
  test.each`
    a    | b    | sum
    ${1} | ${2} | ${3}
    ${4} | ${5} | ${9}
  `("table $a + $b = $sum", ({ a, b, sum }) => {
    expect(a + b).toBe(sum);
    expect({ a, b, sum }).toMatchSnapshot();
  });
  describe.each(["p", "q"])("block %s", s => {
    test("inside", () => {
      expect(s).toMatchSnapshot();
    });
  });
  test.each([1, 1])("same title", n => {
    expect(n).toMatchSnapshot();
  });
});

class Klass {}
function named() {}
describe(Klass, () => {
  test("in a describe named by a class", () => {
    expect(1).toMatchSnapshot();
  });
});
describe(named, () => {
  test("in a describe named by a function", () => {
    expect(1).toMatchSnapshot();
  });
  test(named, () => {
    expect(2).toMatchSnapshot();
  });
});
describe("state", () => {
  test("currentTestName", () => {
    expect(expect.getState().currentTestName).toMatchSnapshot();
  });
  describe("deeper", () => {
    test("in a custom matcher", () => {
      let seen;
      expect.extend({
        toRemember() {
          seen = this.currentTestName;
          return { pass: true, message: () => "" };
        },
      });
      expect(1).toRemember();
      expect(seen).toMatchSnapshot();
    });
  });
});
describe("hooks", () => {
  beforeEach(() => {
    expect("from beforeEach").toMatchSnapshot();
  });
  afterEach(() => {
    expect("from afterEach").toMatchSnapshot("after");
  });
  test("first", () => {
    expect("body").toMatchSnapshot();
  });
  test("second", () => {});
});
describe("skipped and todo", () => {
  test.skip("skipped", () => {
    expect("never").toMatchSnapshot();
  });
  test.todo("todo");
  test("runs", () => {
    expect("runs").toMatchSnapshot();
  });
});
