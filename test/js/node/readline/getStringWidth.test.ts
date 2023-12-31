import readline from "node:readline";

var {
  utils: { getStringWidth },
  // @ts-ignore
} = readline[Symbol.for("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__")];

it("handles invisible ASCII character at any position", () => {
  const visible = "a";
  const invisible = String.fromCharCode(3);
  for (let i = 0; i < 48; i++) {
    const str = visible.repeat(i) + invisible + visible.repeat(48 - i);

    expect(getStringWidth(str)).toBe(48);
  }
});

it("handles visible ASCII character at any position", () => {
  const visible = "a";
  const invisible = String.fromCharCode(3);
  for (let i = 0; i < 48; i++) {
    const str = invisible.repeat(i) + visible + invisible.repeat(48 - i);

    expect(getStringWidth(str)).toBe(1);
  }
});

it("handles alternating characters", () => {
  // In node, this is `process.binding("icu").getStringWidth`
  expect(getStringWidth("あ")).toBe(2);
  expect(getStringWidth("'あ")).toBe(3);
  expect(getStringWidth("ああ")).toBe(4);
  expect(getStringWidth("あああ")).toBe(6);
  expect(getStringWidth("'あああ")).toBe(7);
  expect(getStringWidth('"あああ')).toBe(7);
  expect(getStringWidth('"あああ"')).toBe(8);
});
