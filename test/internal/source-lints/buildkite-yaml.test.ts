// .buildkite/ci.ts uploads its pipeline as YAML written by toYaml(). A value
// that is a string has to come back as that string: an agent tag like an AWS
// account id or an OS release is matched as text.
import { expect, test } from "bun:test";
import { toYaml } from "../../../scripts/buildkite.ts";

test("a string comes back from YAML as the same string", () => {
  const agents = {
    "base-image-owner": "099720109477",
    "release": "3.20",
    "debian": "13",
    "windows": "2019",
    "exponent": "1e3",
    "hex": "0x10",
    "leading-dot": ".5",
    "yes": "yes",
    "true": "true",
    "null": "null",
    "tilde": "~",
    "empty": "",
    "name": "linux-x64-debian-24a0b516cbf2b47c",
    "base-image": "ubuntu/images/hvm-ssd-gp3/ubuntu-plucky-25.04-amd64-server-20251210",
    "path": "C:\\intel-sde",
  };
  expect(Bun.YAML.parse(toYaml({ steps: [{ key: "bake", agents }] }))).toEqual({ steps: [{ key: "bake", agents }] });
});

test("numbers, booleans and null stay what they are, and undefined is left out", () => {
  const step = { timeout_in_minutes: 180, soft_fail: false, bake: true, retry: null, skipped: undefined };
  expect(Bun.YAML.parse(toYaml(step))).toEqual({ timeout_in_minutes: 180, soft_fail: false, bake: true, retry: null });
});
