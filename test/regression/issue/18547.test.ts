import { expect, test } from "bun:test";

test("18547", async () => {
  using serve = Bun.serve({
    routes: {
      "/:foo": request => {
        request.cookies.set("sessionToken", "123456");

        // Ensure cloned requests have the same cookies and params of the original
        const clone = request.clone();
        expect(clone.cookies.get("sessionToken")).toEqual("123456");
        expect(clone.params.foo).toEqual("foo");

        // And that changes made to the clone don't affect the original
        clone.cookies.set("sessionToken", "654321");
        expect(request.cookies.get("sessionToken")).toEqual("123456");
        expect(clone.cookies.get("sessionToken")).toEqual("654321");

        return new Response("OK");
      },
    },
  });

  const response = await fetch(`${serve.url}/foo`);
  // Or the context of the original request
  expect(response.headers.get("set-cookie")).toEqual("sessionToken=123456; Path=/; SameSite=Lax");
});
