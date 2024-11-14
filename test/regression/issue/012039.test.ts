import { expect, test } from "bun:test";

// Previously, this would crash due to the invalid property name
test("#12039 ZWJ", async () => {
  const code = /*js*/ `
export default class {
  W‍;
}
`;
  expect(() => new Bun.Transpiler().transformSync(code)).not.toThrow();
});

test("#12039 ZWNJ", async () => {
  const code = /*js*/ `
export default class {
  W${String.fromCodePoint(0x200d)};
}
`;
  expect(() => new Bun.Transpiler().transformSync(code)).not.toThrow();
});

test("#12039 invalid property name for identifier", async () => {
  const code = /*js*/ `
export default class {
  W${String.fromCodePoint(129)};
}
`;
  expect(() => new Bun.Transpiler().transformSync(code)).toThrow(`Unexpected "W`);
});
