// @known-failing-on-windows: 1 failing
import { parseAst } from "rollup/parseAst";

test("it works", () => {
  expect(parseAst("const x = true")).toMatchSnapshot();
});
