import test from "node:test";
import { printed } from "./texts.mjs";

test("prints", () => {
  for (const text of printed.slice(4, 8)) console.log(text);
});
test("fails", () => {
  throw new Error("after the printed names");
});
test("f\u00e4ils \u00ff\u00fe", () => {
  throw new Error("m\u00e9ssage \u00ff\u00fe end");
});
test("fails \u{1f600}", () => {
  throw new Error("h\u00e9llo \u{1f600}");
});
