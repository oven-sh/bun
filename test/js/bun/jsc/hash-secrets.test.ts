import { mapKeyHash } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const keys = [
  "",
  "a",
  "hello",
  "a longer key, past sixteen characters",
  "\u{1F600}",
  0,
  42,
  -7,
  1.5,
  2 ** 40,
  10n ** 30n,
];
const printHashes = `
  const { mapKeyHash } = require("bun:internal-for-testing");
  const keys = ["", "a", "hello", "a longer key, past sixteen characters", "\\u{1F600}", 0, 42, -7, 1.5, 2 ** 40, 10n ** 30n];
  console.log(JSON.stringify(keys.map(mapKeyHash)));
`;

test("a key hashes differently in each process", async () => {
  const runs = await Promise.all(
    [0, 1].map(async () => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", printHashes], env: bunEnv, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout) as number[];
    }),
  );
  const here = keys.map(mapKeyHash);
  for (let i = 0; i < keys.length; i++) {
    expect({ key: String(keys[i]), distinct: new Set([here[i], runs[0][i], runs[1][i]]).size }).toEqual({
      key: String(keys[i]),
      distinct: 3,
    });
  }
});

test("a key hashes the same on every thread of a process", async () => {
  const worker = new Worker(
    `data:text/javascript,${encodeURIComponent(`
      const { mapKeyHash } = require("bun:internal-for-testing");
      self.onmessage = ({ data }) => postMessage(data.map(mapKeyHash));
    `)}`,
    { env: bunEnv },
  );
  try {
    const { promise, resolve, reject } = Promise.withResolvers<number[]>();
    worker.onmessage = ({ data }) => resolve(data);
    worker.onerror = reject;
    worker.postMessage(keys);
    expect(await promise).toEqual(keys.map(mapKeyHash));
  } finally {
    worker.terminate();
  }
});

// With rapidhash's published secrets, bytes 0-3 and 12-15 of these cancel secret[1], so the 128-bit multiply is by zero
// and all of them get one hash.
test("strings that share a hash under rapidhash's published secrets are spread out", () => {
  const strings = Array.from(
    { length: 4096 },
    (_, i) => "\x93K\xb8\x8b" + i.toString(36).padStart(8, "0") + "\xc9\xac.\x96",
  );
  expect(new Set(strings.map(mapKeyHash)).size).toBeGreaterThan(4000);
  expect(new Set(strings.map(s => mapKeyHash(s) & 0xfff)).size).toBeGreaterThan(2000);
});

test("integers that share a bucket under rapidhash's published secrets are spread out", () => {
  // prettier-ignore
  const integers = [166294, 496522, 595946, 609134, 726312, 1173731, 1391937, 1484599, 1489566, 1494948, 1729264, 1777100, 1860014, 1976719, 2386902, 2469315, 2487652, 2758594, 2907947, 3058499, 3224038, 3489203, 3504686, 3504758, 3640286, 3815482, 3932221, 3949213, 4097461, 4270163, 4290996, 4449060];
  expect(new Set(integers.map(i => mapKeyHash(i) & 0x1ffff)).size).toBeGreaterThan(28);
});
