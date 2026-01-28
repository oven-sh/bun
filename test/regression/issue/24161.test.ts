import { expect, test } from "bun:test";

// Test for issue #24161: Long data URLs in Web Workers should work
// zip.js embeds ~25KB worker code in data URIs, which was being rejected
// by the path length limit check before being recognized as data URLs.

test("Worker from a long data URL (>6KB)", async () => {
  // Create a data URL that's longer than the MAX_PATH_BYTES * 1.5 (~6KB) limit
  // by padding the worker code with a large comment
  const padding = "a".repeat(10000); // 10KB of padding
  const workerCode = `
    /* ${padding} */
    self.onmessage = e => {
      self.postMessage(e.data + " processed");
    };
  `;

  const dataUrl = `data:text/javascript,${encodeURIComponent(workerCode)}`;

  // Verify our data URL is actually longer than the threshold
  expect(dataUrl.length).toBeGreaterThan(6144);

  const worker = new Worker(dataUrl);

  const result = await new Promise((resolve, reject) => {
    worker.onerror = e => reject(e.message);
    worker.onmessage = e => {
      worker.terminate();
      resolve(e.data);
    };
    worker.postMessage("test");
  });

  expect(result).toBe("test processed");
});

test("Worker from a long base64 data URL", async () => {
  // Create worker code and encode as base64
  const padding = "a".repeat(10000);
  const workerCode = `
    /* ${padding} */
    self.onmessage = e => {
      self.postMessage(e.data + " base64");
    };
  `;

  const base64Code = Buffer.from(workerCode).toString("base64");
  const dataUrl = `data:text/javascript;base64,${base64Code}`;

  // Verify our data URL is actually longer than the threshold
  expect(dataUrl.length).toBeGreaterThan(6144);

  const worker = new Worker(dataUrl);

  const result = await new Promise((resolve, reject) => {
    worker.onerror = e => reject(e.message);
    worker.onmessage = e => {
      worker.terminate();
      resolve(e.data);
    };
    worker.postMessage("test");
  });

  expect(result).toBe("test base64");
});

test("Dynamic import of long data URL", async () => {
  // Test that dynamic import of long data URLs also works
  const padding = "a".repeat(10000);
  const moduleCode = `
    /* ${padding} */
    export const value = "imported successfully";
  `;

  const dataUrl = `data:text/javascript,${encodeURIComponent(moduleCode)}`;

  // Verify our data URL is actually longer than the threshold
  expect(dataUrl.length).toBeGreaterThan(6144);

  const module = await import(dataUrl);
  expect(module.value).toBe("imported successfully");
});
