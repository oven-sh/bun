import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("latin1 property name", () => {
  const { stdout } = Bun.spawnSync({
    cmd: [bunExe(), "run", require("path").join(import.meta.dir, "./property-latin1-fixture.js")],
    env: bunEnv,
  });
  const filtered = stdout.toString().replaceAll("\n", "").replaceAll(" ", "");
  expect(filtered).toBe(
    `{
      "código": 1,
      "código2": 2,
      "código3": 3,
      "código4": 4,
      "código5": 5
    } 1 1 2 3 4 3 2 4 5 2
`
      .replaceAll("\n", "")
      .replaceAll(" ", ""),
  );
  // just to be sure
  expect(Buffer.from(Bun.CryptoHasher.hash("sha1", filtered) as Uint8Array).toString("hex")).toBe(
    "9459ed53a27b14076123524ee68df0ce963cac5c",
  );
});
