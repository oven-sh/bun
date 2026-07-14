import { parseAst } from "rollup/parseAst";

test.skipIf(isOhos)("it works", () => {
  expect(parseAst("const x = true")).toMatchSnapshot();
});
