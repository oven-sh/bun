import { createTest } from "node-harness";
import { OutgoingMessage } from "node:http";
const { expect } = createTest(import.meta.path);

const om = new OutgoingMessage();
expect(om.constructor).toBe(OutgoingMessage);
