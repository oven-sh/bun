import { describe, test, expect } from "bun:test";

console.log("enter");

describe("describe 1", () => {
  console.log("describe 1");
  describe("describe 2", () => {
    console.log("describe 2");
  });
  describe("describe 3", () => {
    console.log("describe 3");
  });
});
describe("describe 4", () => {
  console.log("describe 4");
  describe("describe 5", () => {
    console.log("describe 5");
    describe("describe 6", () => {
      console.log("describe 6");
    });
    describe("describe 7", () => {
      console.log("describe 7");
    });
  });
});
describe("describe 8", () => {
  console.log("describe 8");
});

// == async ==

describe("async describe 1", async () => {});

console.log("exit");
