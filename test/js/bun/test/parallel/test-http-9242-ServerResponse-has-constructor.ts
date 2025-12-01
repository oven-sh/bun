import { createTest } from "node-harness";
import { ServerResponse } from "node:http";
const { expect } = createTest(import.meta.path);

const sr = new ServerResponse({});
expect(sr.constructor).toBe(ServerResponse);
