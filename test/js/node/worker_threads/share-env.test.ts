import { test, expect } from "bun:test";
import { Worker, SHARE_ENV } from "worker_threads";

test("SHARE_ENV symbol should be accepted as env option", async () => {
  // This test verifies that the SHARE_ENV symbol is properly accepted
  // as the env option in worker threads, fixing the issue where it was
  // incorrectly rejected as an invalid type
  
  const worker = new Worker(
    `
    const { parentPort } = require('worker_threads');
    // Send back the current environment variable to verify SHARE_ENV works
    parentPort.postMessage({ 
      PATH: process.env.PATH ? 'present' : 'absent',
      NODE_ENV: process.env.NODE_ENV 
    });
    `,
    {
      eval: true,
      env: SHARE_ENV
    }
  );

  const message = await new Promise((resolve, reject) => {
    worker.on("message", resolve);
    worker.on("error", reject);
    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  // Verify that environment variables are shared from parent process
  expect(message).toHaveProperty("PATH");
  expect((message as any).PATH).toBe("present");

  await worker.terminate();
});

test("SHARE_ENV enables true environment sharing", async () => {
  // Set a unique test variable in the parent
  const testVar = `TEST_VAR_${Date.now()}`;
  process.env[testVar] = "parent_value";
  
  const worker = new Worker(
    `
    const { parentPort } = require('worker_threads');
    // Worker should see the parent's environment variable
    parentPort.postMessage({
      testVar: process.env["${testVar}"],
      hasTestVar: "${testVar}" in process.env
    });
    `,
    {
      eval: true,
      env: SHARE_ENV
    }
  );

  const message = await new Promise((resolve, reject) => {
    worker.on("message", resolve);
    worker.on("error", reject);
    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  // Verify the worker can see the parent's environment variable
  expect((message as any).hasTestVar).toBe(true);
  expect((message as any).testVar).toBe("parent_value");

  // Clean up
  delete process.env[testVar];
  await worker.terminate();
});

test("SHARE_ENV should be the correct symbol", () => {
  // Verify that SHARE_ENV is the expected symbol
  expect(typeof SHARE_ENV).toBe("symbol");
  expect(SHARE_ENV.description).toBe("nodejs.worker_threads.SHARE_ENV");
});

test("non-SHARE_ENV symbols should still be rejected", async () => {
  const someOtherSymbol = Symbol("other.symbol");
  
  expect(() => {
    new Worker("", {
      eval: true,
      env: someOtherSymbol as any
    });
  }).toThrow(/The "options\.env" property must be of type object or one of undefined, null, or worker_threads\.SHARE_ENV/);
});

test("other env option types should still work", async () => {
  // Test that regular object env still works
  const worker1 = new Worker(
    `
    const { parentPort } = require('worker_threads');
    parentPort.postMessage(process.env.CUSTOM_VAR);
    `,
    {
      eval: true,
      env: { CUSTOM_VAR: "custom_value" }
    }
  );

  const message1 = await new Promise((resolve, reject) => {
    worker1.on("message", resolve);
    worker1.on("error", reject);
    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  expect(message1).toBe("custom_value");
  await worker1.terminate();

  // Test that undefined env still works
  const worker2 = new Worker(
    `
    const { parentPort } = require('worker_threads');
    parentPort.postMessage('success');
    `,
    {
      eval: true,
      env: undefined
    }
  );

  const message2 = await new Promise((resolve, reject) => {
    worker2.on("message", resolve);
    worker2.on("error", reject);
    setTimeout(() => reject(new Error("Test timeout")), 5000);
  });

  expect(message2).toBe("success");
  await worker2.terminate();

  // Test that null env still works
  expect(() => {
    new Worker(
      `
      const { parentPort } = require('worker_threads');
      parentPort.postMessage('success');
      `,
      {
        eval: true,
        env: null
      }
    );
  }).not.toThrow();
});