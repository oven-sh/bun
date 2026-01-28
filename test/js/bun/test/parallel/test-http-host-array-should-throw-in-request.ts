import { createTest } from "node-harness";
import http from "node:http";
const { expect } = createTest(import.meta.path);

expect(() => http.request({ host: [1, 2, 3] })).toThrow(
  'The "options.host" property must be of type string, undefined, or null. Received an instance of Array',
);
