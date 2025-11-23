import { expect, test } from "bun:test";

test("Japanese middle dot character should be allowed in identifier names", () => {
  // Test the full-width middle dot (・) character U+30FB
  const code1 = `
    const obj = {
      "バス・トイレ": "bathroom"
    };
    obj["バス・トイレ"];
  `;
  expect(() => eval(code1)).not.toThrow();

  // Test unquoted property with middle dot
  const code2 = `
    const obj = {
      バス・トイレ: "bathroom"
    };
    obj["バス・トイレ"];
  `;
  expect(() => eval(code2)).not.toThrow();

  // Test variable name with middle dot continuation
  const code3 = `
    let test・variable = 42;
    test・variable;
  `;
  expect(() => eval(code3)).not.toThrow();

  // Test the half-width middle dot (･) character U+FF65 as well
  const code4 = `
    const obj = {
      test･value: "test"
    };
    obj["test･value"];
  `;
  expect(() => eval(code4)).not.toThrow();
});

test("Middle dot should not be allowed at start of identifier", () => {
  // Middle dot should NOT be allowed as identifier start
  const code1 = `
    var ・test = 1;
  `;
  expect(() => eval(code1)).toThrow();

  const code2 = `
    var ･test = 1;
  `;
  expect(() => eval(code2)).toThrow();
});
