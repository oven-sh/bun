import { compileString } from "sass";

test("sass source maps", () => {
  const scssString = `.ruleGroup {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border-width: 1px;
  }
  `;

  expect(compileString(scssString, { sourceMap: false })).toMatchSnapshot();
  expect(compileString(scssString, { sourceMap: true })).toMatchSnapshot();
});
