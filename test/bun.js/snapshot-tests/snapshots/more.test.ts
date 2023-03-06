describe("d0", () => {
  test("snapshot name edgecases", () => {
    expect(1).toMatchSnapshot();
    expect("1\b2\n3\r4").toMatchSnapshot();
    expect("\r\n").toMatchSnapshot();
    expect("1\b2\n3\r\r\r\r\r\r\r\r\r\r\r\r4\v5\f6\t7\\\n\r\n\n\nr\nr\n").toMatchSnapshot();
    expect("1\b2\n3\r4\v5\f6\t7\\").toMatchSnapshot();
    expect("\r").toMatchSnapshot();
    expect("\n").toMatchSnapshot();
    expect("\\").toMatchSnapshot();
    expect("\v").toMatchSnapshot();
    expect("\f").toMatchSnapshot();
    expect("\t").toMatchSnapshot();
    expect("\b").toMatchSnapshot();
    expect("\b\t").toMatchSnapshot();

    expect(`hello sn
    apshot`).toMatchSnapshot();
    expect(new String()).toMatchSnapshot();
    expect(new String("")).toMatchSnapshot();

    expect({ a: { b: 1 } }).toEqual({ a: { b: 1 } });
    expect("\\\nexport with test name\n\n").toMatchSnapshot();

    expect(1).toMatchSnapshot();
    expect(1).toMatchSnapshot("one");
    expect(2).toMatchSnapshot();
    expect(3).toMatchSnapshot("one");
    expect("one two three").toMatchSnapshot();
    expect("\nexport[\\`hello snap'shot 2`] = `").toMatchSnapshot();
    expect("\nexport[`hello snapshot 2`] = `").toMatchSnapshot();
  });
});

describe("d0", () => {
  describe("d1", () => {
    test("t1", () => {
      expect("hello`snapshot\\").toEqual("hello`snapshot\\");
      expect("hello`snapshot\\").toMatchSnapshot();
    });
    test("t2", () => {
      expect("hey").toMatchSnapshot();
    });
  });
  test("t3", () => {
    expect("hello snapshot").toMatchSnapshot();
  });
  test("t4", () => {
    expect("hello`snapshot\\").toMatchSnapshot();
  });
});
