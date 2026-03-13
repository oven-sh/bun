import { createTest, exampleSite } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);
await using server = exampleSite("https");
expect(() => http.request(server.url)).toThrow(TypeError);
expect(() => http.request(server.url)).toThrow({
  code: "ERR_INVALID_PROTOCOL",
  message: `Protocol "https:" not supported. Expected "http:"`,
});
