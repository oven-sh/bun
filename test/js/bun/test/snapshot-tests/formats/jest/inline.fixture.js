describe("inline", () => {
  test("number", () => {
    expect(1).toMatchInlineSnapshot(`1`);
  });
  test("string", () => {
    expect("text").toMatchInlineSnapshot(`"text"`);
  });
  test("object", () => {
    expect({ a: 1, b: [1, 2], c: { d: null } }).toMatchInlineSnapshot(`
{
  "a": 1,
  "b": [
    1,
    2,
  ],
  "c": {
    "d": null,
  },
}
`);
  });
  test("multi-line string", () => {
    expect(`one
two
  three`).toMatchInlineSnapshot(`
"one
two
  three"
`);
  });
  test("odd characters", () => {
    expect("a `b` ${c} \\d $e").toMatchInlineSnapshot(`"a \`b\` \${c} \\d $e"`);
  });
  test("empty string", () => {
    expect("").toMatchInlineSnapshot(`""`);
  });
  test("string with blank lines", () => {
    expect(`a

b
`).toMatchInlineSnapshot(`
"a

b
"
`);
  });
  test("string with leading spaces", () => {
    expect(`  a
    b`).toMatchInlineSnapshot(`
"  a
    b"
`);
  });
  test("with properties", () => {
    expect({ id: 3, n: "x" }).toMatchInlineSnapshot({ id: expect.any(Number) }, `
{
  "id": Any<Number>,
  "n": "x",
}
`);
  });
  test("mock", () => {
    expect(jest.fn()).toMatchInlineSnapshot(`[MockFunction]`);
    expect({ f: jest.fn().mockName("nm") }).toMatchInlineSnapshot(`
{
  "f": [MockFunction nm],
}
`);
  });
  test("error", () => {
    expect(new Error("as value")).toMatchInlineSnapshot(`[Error: as value]`);
  });
  test("thrown", () => {
    expect(() => {
  throw new Error("thrown message");
}).toThrowErrorMatchingInlineSnapshot(`"thrown message"`);
  });
  test("thrown multi-line", () => {
    expect(() => {
  throw new TypeError(`thrown
message`);
}).toThrowErrorMatchingInlineSnapshot(`
"thrown
message"
`);
  });
  test("rejects", async () => {
    await expect(Promise.reject(new Error("rejected"))).rejects.toThrowErrorMatchingInlineSnapshot(`"rejected"`);
  });
  test("resolves", async () => {
    await expect(Promise.resolve([1])).resolves.toMatchInlineSnapshot(`
[
  1,
]
`);
  });
  test("counts together with file snapshots", () => {
    expect("file 1").toMatchSnapshot();
    expect("inline").toMatchInlineSnapshot(`"inline"`);
    expect("file 2").toMatchSnapshot();
  });
});
