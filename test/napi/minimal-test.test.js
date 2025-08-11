import { test, expect } from "bun:test";

test("basic test without addon", () => {
  console.log("Basic test running");
  expect(2 + 2).toBe(4);
});

test("require existing addon", () => {
  console.log("Trying to require existing addon");
  try {
    const addon = require("./napi-app/build/Debug/napitests.node");
    console.log("Existing addon loaded:", typeof addon);
  } catch (error) {
    console.log("Error loading existing addon:", error.message);
  }
});