import { createTest } from "node-harness";
import https from "node:https";
const { expect } = createTest(import.meta.path);

const agent = new https.Agent();
const { promise, resolve } = Promise.withResolvers();
https.get({ agent, hostname: "google.com" }, resolve);
const response = await promise;
expect(response.req.agent.defaultPort).toBe(443);
expect(response.req.protocol).toBe("https:");
