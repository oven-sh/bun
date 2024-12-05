// @ts-nocheck
// can't use @types/express or @types/body-parser because they
// depend on @types/node which conflicts with bun-types
import { expect, test } from "bun:test";
import got from "got";

test("should respond with 404 when wrong method is used", async () => {
  await got("https://bun.sh", {
    http2: true,
  });
});
