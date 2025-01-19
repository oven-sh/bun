import t1 from "./a.txt?1" with { type: "file" };
import t2 from "./a.txt?2";
import t3 from "./a.txt" with { type: "file" };
import w1 from "./a.wasm?1";
import w2 from "./a.wasm?2";

test("question mark imports", () => {
  expect(t1).toEndWith("a.txt");
  expect(t2).toBe("hello");
  expect(t3).toEndWith("a.txt");
  expect(w1).toEndWith("a.wasm");
  expect(w2).toEndWith("a.wasm");
});
