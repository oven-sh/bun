import { describe, it, expect } from "bun:test";
import { request } from "undici";

describe("undici", () => {
  describe("request", () => {
    it("should make a GET request when passed a URL string", async () => {
      const { body } = await request("https://httpbin.org/get");
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe("https://httpbin.org/get");
    });

    it("should error when body has already been consumed", async () => {
      const { body } = await request("https://httpbin.org/get");
      await body.json();
      expect(body.bodyUsed).toBe(true);
      try {
        await body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("unusable");
      }
    });

    it("should make a POST request when provided a body and POST method", async () => {
      const { body } = await request("https://httpbin.org/post", {
        method: "POST",
        body: "Hello world",
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { data: string };
      expect(json.data).toBe("Hello world");
    });

    it("should accept a URL class object", async () => {
      const { body } = await request(new URL("https://httpbin.org/get"));
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe("https://httpbin.org/get");
    });

    // it("should accept an undici UrlObject", async () => {
    //   // @ts-ignore
    //   const { body } = await request({ protocol: "https:", hostname: "httpbin.org", path: "/get" });
    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { url: string };
    //   expect(json.url).toBe("https://httpbin.org/get");
    // });

    it("should prevent body from being attached to GET or HEAD requests", async () => {
      try {
        await request("https://httpbin.org/get", {
          method: "GET",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }

      try {
        await request("https://httpbin.org/head", {
          method: "HEAD",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }
    });

    it("should allow a query string to be passed", async () => {
      const { body } = await request("https://httpbin.org/get?foo=bar");
      expect(body).toBeDefined();
      const json = (await body.json()) as { args: { foo: string } };
      expect(json.args.foo).toBe("bar");

      const { body: body2 } = await request("https://httpbin.org/get", {
        query: { foo: "bar" },
      });
      expect(body2).toBeDefined();
      const json2 = (await body2.json()) as { args: { foo: string } };
      expect(json2.args.foo).toBe("bar");
    });

    it("should throw on HTTP 4xx or 5xx error when throwOnError is true", async () => {
      try {
        await request("https://httpbin.org/status/404", { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 404");
      }

      try {
        await request("https://httpbin.org/status/500", { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 500");
      }
    });

    it("should allow us to abort the request with a signal", async () => {
      const controller = new AbortController();
      try {
        setTimeout(() => controller.abort(), 1000);
        const req = await request("https://httpbin.org/delay/5", {
          signal: controller.signal,
        });
        await req.body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("The operation was aborted.");
      }
    });

    it("should properly append headers to the request", async () => {
      const { body } = await request("https://httpbin.org/headers", {
        headers: {
          "x-foo": "bar",
        },
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { headers: { "X-Foo": string } };
      expect(json.headers["X-Foo"]).toBe("bar");
    });

    // it("should allow the use of FormData", async () => {
    //   const form = new FormData();
    //   form.append("foo", "bar");
    //   const { body } = await request("https://httpbin.org/post", {
    //     method: "POST",
    //     body: form,
    //   });

    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { form: { foo: string } };
    //   expect(json.form.foo).toBe("bar");
    // });
  });
});
