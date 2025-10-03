import { createTest } from "node-harness";
import https from "node:https";
const { expect } = createTest(import.meta.path);

const agent = new https.Agent();
expect(agent.defaultPort).toBe(443);
expect(agent.protocol).toBe("https:");
