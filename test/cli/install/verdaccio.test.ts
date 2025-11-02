import { test, expect } from "bun:test";
import { VerdaccioRegistry } from "harness";

test("verdaccio should work", async () => {
  const registry = new VerdaccioRegistry();
  await registry.start();
  
  const url = registry.registryUrl();
  console.log("Registry URL:", url);
  
  const response = await fetch(`${url}no-deps`);
  expect(response.status).toBe(200);
  
  const data = await response.json();
  expect(data.name).toBe("no-deps");
  
  registry.stop();
});
