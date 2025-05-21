import { expect, test } from "bun:test";

test("can read json() from request", async () => {
  for (let i = 0; i < 10; i++) {
    const request = new Request("http://example.com/", {
      method: "PUT",
      body: '[1,2,"hello",{}]',
    });
    expect(await request.json()).toEqual([1, 2, "hello", {}]);
  }
});
