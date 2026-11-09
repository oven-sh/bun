import { createTest } from "node-harness";
import https from "node:https";
const { expect } = createTest(import.meta.path);

const agent = new https.Agent();
expect((agent as any).defaultPort).toBe(443);
expect((agent as any).protocol).toBe("https:");
