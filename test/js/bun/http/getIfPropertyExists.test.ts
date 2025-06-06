import { describe, expect, test } from "bun:test";
import * as RequestOptions from "./bun-request-fixture.js";
import * as ServerOptions from "./bun-serve-exports-fixture.js";

describe("getIfPropertyExists", () => {
  test("Bun.serve()", async () => {
    expect(() => Bun.serve(ServerOptions).stop(true)).not.toThrow();
  });

  test("new Request()", async () => {
    expect(await new Request("https://example.com/", RequestOptions).json()).toEqual({
      hello: "world",
    });
  });

  test("calls proxy getters", async () => {
    expect(
      await new Request(
        "https://example.com/",
        new Proxy(
          {},
          {
            get: (target, prop) => {
              if (prop === "body") {
                return JSON.stringify({ hello: "world" });
              } else if (prop === "method") {
                return "POST";
              }
            },
          },
        ),
      ).json(),
    ).toEqual({
      hello: "world",
    });
  });
});
