import { test, expect } from "bun:test";

test("navigator properties should be getter-only like Node.js", () => {
  const originalUserAgent = navigator.userAgent;
  const originalPlatform = navigator.platform;
  const originalHardwareConcurrency = navigator.hardwareConcurrency;

  // Attempting to modify getter-only properties should silently fail (like Node.js)
  navigator.userAgent = "modified";
  navigator.platform = "modified";
  navigator.hardwareConcurrency = 999;

  // Values should remain unchanged
  expect(navigator.userAgent).toBe(originalUserAgent);
  expect(navigator.platform).toBe(originalPlatform);
  expect(navigator.hardwareConcurrency).toBe(originalHardwareConcurrency);
});

test("navigator properties should have getter-only descriptors like Node.js", () => {
  const userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");
  const platformDescriptor = Object.getOwnPropertyDescriptor(navigator, "platform");
  const hardwareConcurrencyDescriptor = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");

  // Properties should have getters but no setters
  expect(userAgentDescriptor?.get).toBeTypeOf("function");
  expect(userAgentDescriptor?.set).toBeUndefined();
  expect(userAgentDescriptor?.configurable).toBe(false);
  
  expect(platformDescriptor?.get).toBeTypeOf("function");
  expect(platformDescriptor?.set).toBeUndefined();
  expect(platformDescriptor?.configurable).toBe(false);
  
  expect(hardwareConcurrencyDescriptor?.get).toBeTypeOf("function");
  expect(hardwareConcurrencyDescriptor?.set).toBeUndefined();
  expect(hardwareConcurrencyDescriptor?.configurable).toBe(false);
});

test("Object.defineProperty should not be able to modify navigator properties", () => {
  const originalUserAgent = navigator.userAgent;
  
  expect(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "modified",
      writable: true,
      configurable: true
    });
  }).toThrow();
  
  expect(navigator.userAgent).toBe(originalUserAgent);
});