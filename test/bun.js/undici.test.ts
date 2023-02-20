import { describe, it, expect } from "bun:test";
import { request } from "undici";

describe("undici", () => {
  describe("request", () => {
    it("should make a GET request when passed a URL string", async () => {
      const { body } = await request("https://httpbin.org/get");
      expect(body).toBeDefined();
      console.log(body);
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe("https://httpbin.org/get");
    });

    // Test if we can read like normal readable
  });
});
