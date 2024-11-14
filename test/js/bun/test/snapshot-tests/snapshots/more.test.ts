import { describe, expect, test } from "bun:test";

describe("d0", () => {
  test.todo("snapshot serialize edgecases", () => {
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
    expect("`````````\\``````\\`\\``````\\`````\\``\\\\`\\````````````").toMatchSnapshot();
    expect("`````````\\``````\\`\\``````\\`````\\``\\\\`\\````````````\\").toMatchSnapshot();
    expect("\\`````````\\``````\\`\\``````\\`````\\``\\\\`\\````````````").toMatchSnapshot();
    expect("\\`````````\\``````\\`\\``````\\`````\\``\\\\`\\````````````\\").toMatchSnapshot();
    expect("one t`wo `three").toMatchSnapshot();
    expect("one tw\\`o three").toMatchSnapshot();
    expect("\nexport[\\`hello snap'shot 2`] = `").toMatchSnapshot();
    expect("\nexport[`hello snapshot 2`] = `").toMatchSnapshot();
    expect("`hello snapshot3 \\``").toMatchSnapshot();
    expect("`hello snapshot4 \\`\\`").toMatchSnapshot();
    expect("\\`hello snapshot5 \\`\\`").toMatchSnapshot();
    expect({ a: 1, b: 2, c: 3 }).toMatchSnapshot("¾");
    expect({ a: 1, b: 2, c: 3 }).toMatchSnapshot("\uD83D\uDC04");
    expect({ a: "\uD83D\uDC04", b: "🐈" }).toMatchSnapshot("😃");
  });
});

describe("d0", () => {
  describe("d1", () => {
    test.todo("t1", () => {
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
  test.todo("t4", () => {
    expect("hello`snapshot\\").toMatchSnapshot();
  });
});
