import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// getattr() and its kin run code of the program in the middle of a lookup if the name is an instance of a class derived from str that has a
// __hash__ or an __eq__ of its own (differential/mod_hash/attr_names_calls.py has what they find). What such a name raises while the classes are
// searched is lost. The end of a Worker is not: here Workers are ended while they are in those methods, and nothing more of the program may run.

const files = {
  "names.py": `
import types, weakref
class Slow(str):
    def __hash__(self):
        for i in range(60): pass
        return str.__hash__(self)
    def __eq__(self, other):
        for i in range(60): pass
        return str.__eq__(self, other)
class Base:
    m = 'of the base'
    def f(self): pass
class C(Base):
    m = 'of the class'
    def up(self, name): return getattr(super(), name)
class Hook:
    def __getattr__(self, name): return type(name) is Slow
module = types.ModuleType('module'); module.m = 1
def work(rounds):
    o = C(); o.a = 1
    proxy = weakref.proxy(o)
    right = 0
    for i in range(rounds):
        right += getattr(o, Slow('a')) == 1
        right += not hasattr(o, Slow('absent'))
        setattr(o, Slow('b%d' % (i % 7)), i)
        right += getattr(o, 'b%d' % (i % 7)) == i
        delattr(o, Slow('b%d' % (i % 7)))
        right += getattr(o, Slow('m')) == 'of the class'
        right += o.up(Slow('m')) == 'of the base'
        right += getattr(C, Slow('m')) == 'of the class'
        right += getattr(module, Slow('m')) == 1
        right += getattr(o.f, Slow('__name__')) == 'f'
        right += getattr(proxy, Slow('a')) == 1
        right += getattr(Hook(), Slow('anything'))
        right += getattr(o, Slow('absent'), None) is None
    return right
`,
  "worker.js": `
import names from "./names.py";
onmessage = event => {
  postMessage(String(names.work(event.data.rounds)));
  // Goes on until it is terminated.
  for (;;) names.work(50);
};
`,
  "main.js": `
import names from "./names.py";
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
          worker.postMessage({ rounds: 20 });
        }),
    ),
  );
  results.push(String(names.work(20)));
}
console.log(results.join(" "));
`,
};

test(
  "Workers that are ended while the name of an attribute is asked for its hash",
  async () => {
    using dir = tempDir("python-attr-names-terminated", files);
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.js"], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(Array(20).fill("220").join(" ") + "\n");
    expect(exitCode).toBe(0);
  },
  isDebug || isASAN ? 600_000 : 60_000,
);
