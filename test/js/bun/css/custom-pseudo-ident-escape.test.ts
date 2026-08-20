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

test("unknown at-rule names are re-escaped when printed", () => {
  expect(minifyTest("@a\\7dz {}", "")).toBe("@a\\}z{}");
  expect(minifyTest("@a\\7bz;", "")).toBe("@a\\{z;");
});

test("custom media type names are re-escaped when printed", () => {
  expect(minifyTest("@media fake\\7d name { .k { color: red } }", "")).toBe("@media fake\\}name{.k{color:red}}");
});

test("unknown @font-face descriptor names are re-escaped when printed", () => {
  expect(minifyTest("@font-face { fake\\7d name: 1 }", "")).toBe("@font-face{fake\\}name:1}");
  expect(minifyTest("@font-face { --x\\7d y: 1 }", "")).toBe("@font-face{--x\\}y:1}");
});

test("an unrecognized @font-face format() argument is printed as a quoted string", () => {
  expect(minifyTest(`@font-face { src: url(a.woff) format('x")}y') }`, "")).toBe(
    '@font-face{src:url(a.woff)format("x\\")}y")}',
  );
});

test("@font-face format() keeps quoted keywords quoted", () => {
  expect(minifyTest(`@font-face { src: url(a.woff2) format("woff2-variations") }`, "")).toBe(
    '@font-face{src:url(a.woff2)format("woff2-variations")}',
  );
});

test("@font-face font-family keeps quoted names quoted", () => {
  expect(minifyTest(`@font-face { font-family: "Custom Test Font" }`, "")).toBe(
    '@font-face{font-family:"Custom Test Font"}',
  );
});

test("unknown property ids in transition-property values are printed as identifiers", () => {
  expect(minifyTest(".foo { transition-property: fake\\7d name }", "")).toBe(".foo{transition-property:fake\\}name}");
});
