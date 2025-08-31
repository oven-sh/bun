import { test, expect } from "bun:test";
import vm from "node:vm";

test("vm.SourceTextModule should support top-level await", async () => {
  const source = `
await (async () => {
  env.log("top-level await works");
})();
`;

  const context = vm.createContext({
    env: {
      log: (msg: string) => {
        // Store the message for testing
        context.loggedMessage = msg;
      }
    },
    loggedMessage: null
  });

  const mainModule = new vm.SourceTextModule(source, { context });

  expect(mainModule.status).toBe("unlinked");

  await mainModule.link(async (specifier) => {
    throw new Error(`Failed to resolve module: ${specifier}`);
  });

  expect(mainModule.status).toBe("linked");

  await mainModule.evaluate();

  expect(mainModule.status).toBe("evaluated");
  expect(context.loggedMessage).toBe("top-level await works");
});

test("vm.SourceTextModule basic top-level await functionality", async () => {
  const source = `
await (async () => {
  env.result = "success";
})();
`;

  const context = vm.createContext({
    env: {
      result: ""
    }
  });

  const mainModule = new vm.SourceTextModule(source, { context });

  await mainModule.link(async (specifier) => {
    throw new Error(`Failed to resolve module: ${specifier}`);
  });

  await mainModule.evaluate();

  expect(mainModule.status).toBe("evaluated");
  expect(context.env.result).toBe("success");
});

test("vm.SourceTextModule should handle top-level await with error", async () => {
  const source = `
await (async () => {
  throw new Error("async error");
})();
`;

  const context = vm.createContext({});
  const mainModule = new vm.SourceTextModule(source, { context });

  await mainModule.link(async (specifier) => {
    throw new Error(`Failed to resolve module: ${specifier}`);
  });

  let errorThrown = false;
  try {
    await mainModule.evaluate();
  } catch (error) {
    errorThrown = true;
    expect(error.message).toBe("async error");
  }
  
  expect(errorThrown).toBe(true);
  // Note: The module status behavior for async errors might vary between implementations
  // In some cases, the module might remain "evaluated" even if the promise rejects
});