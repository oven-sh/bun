import { test, expect } from "bun:test";
import { YAML } from "bun";

// https://github.com/oven-sh/bun/issues/22659
test("YAML parsing handles '+' character as scalar value", () => {
  // Test case 1: test2 first, test1 second
  const yaml1 = `- test2: next
  test1: +`;

  const result1 = YAML.parse(yaml1);
  expect(result1).toEqual([{ test2: "next", test1: "+" }]);

  // Test case 2: test1 first, test2 second (this was throwing an error)
  const yaml2 = `- test1: +
  test2: next`;

  const result2 = YAML.parse(yaml2);
  expect(result2).toEqual([{ test1: "+", test2: "next" }]);

  // Test case 3: '-' character as scalar value
  const yaml3 = `- test1: -
  test2: value`;

  const result3 = YAML.parse(yaml3);
  expect(result3).toEqual([{ test1: "-", test2: "value" }]);

  // Test case 4: Simple object with + and - values
  const yaml4 = `plus: +
minus: -`;

  const result4 = YAML.parse(yaml4);
  expect(result4).toEqual({ plus: "+", minus: "-" });

  // Test case 5: '+' and '-' in flow collections
  const yaml5 = `[+, -, test]`;
  const result5 = YAML.parse(yaml5);
  expect(result5).toEqual(["+", "-", "test"]);

  const yaml6 = `{a: +, b: -, c: test}`;
  const result6 = YAML.parse(yaml6);
  expect(result6).toEqual({ a: "+", b: "-", c: "test" });
});

// TODO: This is a separate issue with nested lists under object properties
// test.skip("YAML parsing handles nested lists correctly", () => {
//   const yaml = `items:
//   - name: plus
//     value: +
//   - name: minus
//     value: -`;
//
//   const result = YAML.parse(yaml);
//   expect(result).toEqual({
//     items: [
//       { name: "plus", value: "+" },
//       { name: "minus", value: "-" }
//     ]
//   });
// });