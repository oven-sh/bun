import { test, expect } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

test("worker entry-point parse errors surface file path, line and code frame", async () => {
  using dir = tempDir("worker-syntax-error", {
    "bad.js": "// line 1\nconst y = ;\n",
  });
  const badPath = join(String(dir), "bad.js");
  const worker = new Worker(badPath);
  const result: any = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.on("error", resolve);
  });
  expect({
    name: result?.name,
    message: result?.message,
    hasStack: typeof result?.stack === "string",
    sourceURL: typeof result?.sourceURL,
    line: result?.line,
    column: result?.column,
  }).toEqual({
    name: "SyntaxError",
    message: "Unexpected ;",
    hasStack: true,
    sourceURL: "string",
    line: 2,
    column: 11,
  });
  expect(result.sourceURL.replaceAll("\\", "/")).toEndWith("/bad.js");
  expect(result.stack.replaceAll("\\", "/")).toInclude("/bad.js:2:11");
  expect(result.stack).toInclude("const y = ;");
  await worker.terminate();
});

test("worker eval parse errors surface line, column and code frame", async () => {
  const worker = new Worker(`postMessage(throw new Error("boom"))`, { eval: true });
  const result: any = await new Promise(resolve => {
    worker.on("message", resolve);
    worker.on("error", resolve);
  });
  expect(result.name).toBe("SyntaxError");
  expect(result.message).toBe("Unexpected throw");
  expect(result.stack).toBeString();
  // The formatted parse error (code frame + location) reaches the parent,
  // not just the bare message.
  expect(result.stack).toInclude("error: Unexpected throw");
  expect(result.stack).toMatch(/at .+:1:13/);
  expect(result.line).toBe(1);
  expect(result.column).toBe(13);
  await worker.terminate();
});
