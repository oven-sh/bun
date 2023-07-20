import { expect, test } from "bun:test";
import * as worker_threads from "worker_threads";
import worker_threads_default from "worker_threads";

test("not implemented yet module masquerades as undefined and throws an error", () => {
  expect(typeof worker_threads.default).toBe("undefined");
  expect(typeof worker_threads_default).toBe("undefined");
  expect(typeof worker_threads.getEnvironmentData).toBe("undefined");
  expect(typeof worker_threads_default.getEnvironmentData).toBe("undefined");
});

test("esbuild functions with worker_threads stub", async () => {
  const esbuild = await import("esbuild");
  const result = await esbuild.transform('console . log( "hello world" )', { minify: true });
  expect(result.code).toBe('console.log("hello world");\n');
});
