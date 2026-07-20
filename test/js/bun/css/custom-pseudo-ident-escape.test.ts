import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const { minifyTest } = cssInternals;

test("custom pseudo-class names are re-escaped when printed", () => {
  expect(minifyTest(":\\ {w:", "")).toBe(":\\ {w:}");
  expect(minifyTest(":\\ {color: red}", "")).toBe(":\\ {color:red}");
  expect(minifyTest(":hover\\:focus {color: red}", "")).toBe(":hover\\:focus{color:red}");
  expect(minifyTest(":\\ (x) {color: red}", "")).toBe(":\\ (x){color:red}");
});

test("custom pseudo-element names are re-escaped when printed", () => {
  expect(minifyTest("::\\ {color: red}", "")).toBe("::\\ {color:red}");
  expect(minifyTest("::\\ (x) {color: red}", "")).toBe("::\\ (x){color:red}");
});

test("minified output with escaped pseudo names round-trips", () => {
  for (const source of [":\\ {w:", ":\\ {color: red}", "::\\ {color: red}", ":hover\\:focus {color: red}"]) {
    const minified = minifyTest(source, "");
    expect(minifyTest(minified, "")).toBe(minified);
  }
});

test("ordinary unknown pseudo names are unchanged", () => {
  expect(minifyTest(":unknown-pseudo {color: red}", "")).toBe(":unknown-pseudo{color:red}");
  expect(minifyTest("::-webkit-unknown {color: red}", "")).toBe("::-webkit-unknown{color:red}");
  expect(minifyTest(":-custom-fn(x) {color: red}", "")).toBe(":-custom-fn(x){color:red}");
});
