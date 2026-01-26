// @bun
//@ runDefault("--useConcurrentJIT=0", "--jitPolicyScale=0.001")

function shouldBe(actual, expected) {
    if (String(actual) !== expected)
        throw new Error('bad value: ' + actual);
}
noInline(shouldBe);

const arr = [[11, 22, 33]];
class CC {
  constructor(a) {
    [a] = arr;
    for (let i = 0; i < 8; i++) {
      shouldBe(a, `11,22,33`);
    }
    const c = [53255];
    c[8] = 2;
  }
}
new CC();
new CC();
