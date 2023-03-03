describe("d0", () => {
  test("hello snapshot", () => {
    expect(1).toMatchSnapshot();
    expect("\nexport with test name noooooooo\n\n").toMatchSnapshot();
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
