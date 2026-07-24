import { nodeHttpInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

const { kHandle, getRequestTimeout } = nodeHttpInternals;

// Server-side IncomingMessage.setTimeout(msecs) flows through
// NodeHTTPResponse__setTimeout with Math.ceil(msecs / 1000). The seconds value
// must be clamped via JSValue.toU32 (negatives → 0, huge → u32::MAX) before
// min(255); a signed-wrap-then-reinterpret (`to_int32() as c_uint`) would turn
// -1 into u32::MAX → 255 instead of 0.
test("server IncomingMessage.setTimeout clamps seconds like JSValue.toU32", async () => {
  const results: Record<string, number> = {};
  const server = http.createServer((req, res) => {
    const handle = (req as any)[kHandle];
    for (const [label, msecs] of cases) {
      req.setTimeout(msecs);
      results[label] = getRequestTimeout(handle);
    }
    req.setTimeout(0);
    res.end("ok");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const { port } = server.address() as AddressInfo;
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      });
      req.on("error", reject);
    });
    expect(body).toBe("ok");
    expect(results).toEqual({
      "-1000": 0,
      "-1000000": 0,
      "-Infinity": 0,
      "0": 0,
      "2000": 2,
      "254000": 254,
      "255000": 255,
      "256000": 255,
      "1e12": 255,
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

const cases: Array<[string, number]> = [
  ["-1000", -1000],
  ["-1000000", -1000000],
  ["-Infinity", -Infinity],
  ["0", 0],
  ["2000", 2000],
  ["254000", 254000],
  ["255000", 255000],
  ["256000", 256000],
  ["1e12", 1e12],
];
