import { test, expect, describe } from "bun:test";
import { $ } from "bun";

describe("http response does not include an extraneous terminating 0\\r\\n\\r\\n", () => {
  const scenarios = [
    {
      port: 0,

      async fetch(req) {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("hello");
              await controller.end();
            },
          }),
          {
            headers: {
              "Content-Type": "text/plain",
            },
          },
        );
      },
    },
    {
      port: 0,

      async fetch(req) {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("hello");
              await Bun.sleep(5);
              await controller.end();
            },
          }),
          {
            headers: {
              "Content-Type": "text/plain",
            },
          },
        );
      },
    },
    {
      port: 0,

      async fetch(req) {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("hello");
              await controller.flush();
              await controller.close();
            },
          }),
          {
            headers: {
              "Content-Type": "text/plain",
            },
          },
        );
      },
    },
    {
      port: 0,

      async fetch(req) {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              await Bun.sleep(1);
              controller.write("hello");
              await controller.flush();
              await controller.close();
            },
          }),
          {
            headers: {
              "Content-Type": "text/plain",
            },
          },
        );
      },
    },
  ];
  for (let i = 0; i < scenarios.length; i++) {
    test("scenario " + i, async () => {
      using server = Bun.serve(scenarios[i]);
      const { stdout, stderr } = await $`curl ${server.url} --verbose`.quiet();
      expect(stdout.toString()).toBe("hello");
      expect(stderr.toString()).toContain("left intact");
    });
  }
});
