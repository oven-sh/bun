import { test, expect } from "bun:test";

// Previously, this would crash due to the invalid property name
test("#12039", async () => {
  const code = /*js*/ `
export default class {
  // zero width joiner is important here!
  W‍: 1;
}
`;
  expect(() => new Bun.Transpiler().transformSync(code)).toThrow(`Unexpected "W"`);
});
