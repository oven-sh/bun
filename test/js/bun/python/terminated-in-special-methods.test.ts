import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// A Worker is ended while a dict or a set is asking a key for its hash or whether it is equal, or type() is telling a descriptor its name, in
// methods written in Python, or while hash() is making an int of a hash that takes 64 bits. The process goes on.

const files = {
  "keys.py": `
class K:
    def __init__(self, n): self.n = n
    def __hash__(self):
        for i in range(60): pass
        return self.n % 3
    def __eq__(self, other):
        for i in range(60): pass
        return self.n == other.n
class Named:
    def __set_name__(self, owner, name):
        for i in range(60): pass
        self.name = name
def keys():
    d = {}; s = set()
    for n in range(6):
        d[K(n)] = n
        s.add(K(n))
    return d[K(4)] == 4 and K(5) in s and K(7) not in d and len(s) == 6 and frozenset(s) == s
def classes():
    return type('X', (), {'a': Named(), 'b': Named()}).b.name == 'b'
def hashes():
    return all(hash('abc') != hash('abd') and hash((1, n)) != hash((2, n)) and hash(b'abc') == hash('abc') for n in range(200))
def work(rounds, kinds):
    return sum(globals()[kind]() for i in range(rounds) for kind in kinds)
`,
  "worker.js": `
import keys from "./keys.py";
onmessage = event => {
  postMessage(String(keys.work(10, ["keys", "classes", "hashes"])));
  // Goes on until it is terminated.
  for (;;) keys.work(50, [event.data.kind]);
};
`,
  "main.js": `
import keys from "./keys.py";
const results = [];
for (let wave = 0; wave < 4; wave++) {
  await Promise.all(
    [0, 1, 2, 3].map(
      number =>
        new Promise(resolve => {
          const worker = new Worker(new URL("./worker.js", import.meta.url).href);
          worker.addEventListener("close", () => resolve());
          worker.onmessage = event => {
            results.push(event.data);
            // It is at work again by now. Each is given another while.
            setTimeout(() => worker.terminate(), (wave * 4 + number) % 5);
          };
          worker.postMessage({ kind: ["keys", "classes", "hashes"][(wave + number) % 3] });
        }),
    ),
  );
  results.push(String(keys.work(10, ["keys", "classes", "hashes"])));
}
console.log(results.join(" "));
`,
};

test(
  "Workers that are ended in the methods that a dict, a set or type() is calling",
  async () => {
    using dir = tempDir("python-terminated-in-special-methods", files);
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.js"], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(Array(20).fill("30").join(" ") + "\n");
    expect(exitCode).toBe(0);
  },
  isDebug || isASAN ? 600_000 : 60_000,
);
