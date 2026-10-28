// `agent: false` uses a fresh agent: http.Agent for http, https.Agent for https. Node makes one of the global agent's class
// (`new defaultAgent.constructor()`). That read is not one the ahead-of-time compiler can pin, so Bun makes one of the module's own
// class (see src/js/node/_http_client.ts, #47155).
import { describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";

// The request is destroyed before its socket is made: only the agent it was given matters here.
function agentOf(request: typeof http.request, options: object) {
  const req = request({ host: "127.0.0.1", port: 1, path: "/", agent: false, ...options });
  req.on("error", () => {});
  req.destroy();
  return req.agent;
}

describe("agent: false", () => {
  test("makes a fresh http.Agent for http", () => {
    const agent = agentOf(http.request, {});
    expect(agent).toBeInstanceOf(http.Agent);
    expect(agent).not.toBe(http.globalAgent);
    expect(agent.constructor).toBe(http.Agent);
  });

  test("makes a fresh https.Agent for https", () => {
    const agent = agentOf(https.request, {});
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent).not.toBe(https.globalAgent);
    expect(agent.constructor).toBe(https.Agent);
  });

  test("makes a fresh agent of the module's class, not of a replaced global agent's", () => {
    class KeepAliveAgent extends http.Agent {}
    const saved = http.globalAgent;
    http.globalAgent = new KeepAliveAgent();
    try {
      const agent = agentOf(http.request, {});
      expect(agent).toBeInstanceOf(http.Agent);
      expect(agent.constructor).toBe(http.Agent);
      expect(agent).not.toBe(http.globalAgent);
    } finally {
      http.globalAgent = saved;
    }
  });

  test("makes a fresh https.Agent for https whatever _defaultAgent holds", () => {
    const duck = { protocol: "https:", addRequest() {}, destroy() {} };
    const agent = agentOf(https.request, { _defaultAgent: duck });
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent).not.toBe(duck);
  });
});
