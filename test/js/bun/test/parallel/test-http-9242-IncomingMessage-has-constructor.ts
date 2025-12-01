import { createTest } from "node-harness";
import { IncomingMessage } from "node:http";
const { expect } = createTest(import.meta.path);

const im = new IncomingMessage("http://localhost");
expect(im.constructor).toBe(IncomingMessage);
