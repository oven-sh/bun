import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

expect(() => http.request("https://example.com")).toThrow(TypeError);
expect(() => http.request("https://example.com")).toThrow({
  code: "ERR_INVALID_PROTOCOL",
  message: `Protocol "https:" not supported. Expected "http:"`,
});
