import { createTest } from "node-harness";
import https from "node:https";
const { expect } = createTest(import.meta.path);

// TODO: today we use a workaround to continue event, we need to fix it in the future.

let receivedContinue = false;
const req = https.request(
  "https://example.com",
  { headers: { "accept-encoding": "identity", "expect": "100-continue" } },
  res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(receivedContinue).toBe(true);
      expect(data).toContain("This domain is for use in illustrative examples in documents");
      process.exit();
    });
  },
);
req.on("continue", () => {
  receivedContinue = true;
});
req.end();
