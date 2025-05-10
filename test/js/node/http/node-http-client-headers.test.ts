import { bunExe } from "harness";

function toObject(str: string) {
  const split = str.split("%<test>");
  const result = {};
  for (const line of split) {
    if (!line.trim()) continue;
    const [key, value] = line.split("</test>");
    result[key] = value;
  }
  return result;
}

describe("node-http-client-headers", async () => {
  const expected = Bun.spawnSync(["node", import.meta.dir + "/fixtures/node-http-client-headers.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const actual = Bun.spawnSync([bunExe(), import.meta.dir + "/fixtures/node-http-client-headers.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(actual.stderr.toString()).toEqual(expected.stderr.toString());
  expect(actual.exitCode).toEqual(expected.exitCode);
  const expected_obj = toObject(expected.stdout.toString());
  const actual_obj = toObject(actual.stdout.toString());
  for (const [key, value] of Object.entries(expected_obj)) {
    test(key, () => {
      expect(actual_obj[key]).toEqual(value);
    });
  }
});
