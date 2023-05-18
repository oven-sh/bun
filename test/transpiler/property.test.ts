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
"código4": 4
} 1 1 2 3 4 3 2 4
`
      .replaceAll("\n", "")
      .replaceAll(" ", ""),
  );
  // just to be sure
  expect(Bun.hash(filtered)).toBe(808511629428895);
});
