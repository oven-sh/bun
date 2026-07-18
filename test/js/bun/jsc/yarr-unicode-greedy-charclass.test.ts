import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Greedy variable-width Unicode character-class backtracking in the YARR JIT used to
// rematch from the beginning of the quantifier on every single backtrack step, turning a
// quadratic scan into a cubic one for patterns like /[^"]*X/u on 16-bit input. The
// correctness tests below guard the O(1) backward step that replaced that rematch loop;
// the performance test asserts the cubic blowup is gone.

describe("backtracking greedy /u character class", () => {
  // Patterns crafted so the greedy class consumes the whole string and must backtrack
  // across a mix of BMP code units, valid surrogate pairs, and lone surrogates.
  test.each([
    // [pattern, input, expectedMatch]
    [/([^"]*)Z/u, "abcZ", "abcZ"],
    [/([^"]*)Z/u, "\u{1F600}abZ", "\u{1F600}abZ"],
    [/([^"]*)Z/u, "ab\u{1F600}Z", "ab\u{1F600}Z"],
    [/([^"]*)Z/u, "ab\u{1F600}cdZ", "ab\u{1F600}cdZ"],
    [/([^"]*)Z/u, "\u{1F600}\u{1F600}Z", "\u{1F600}\u{1F600}Z"],
    [/([^"]*)Z/u, "\u2014abcZdef", "\u2014abcZ"],
    // greedy consumes everything, backtracks past trailing pairs to find Z
    [/([^"]*)Z/u, "Z\u{1F600}\u{1F600}", "Z"],
    [/([^"]*)Z/u, "aZ\u{1F600}b\u{1F600}", "aZ"],
    // lone surrogates treated as width-1
    [/([^"]*)Z/u, "\uDC00Z", "\uDC00Z"],
    [/([^"]*)Z/u, "\uD800Z", "\uD800Z"],
    [/([^"]*)Z/u, "\uD800\uD800Z", "\uD800\uD800Z"],
    [/([^"]*)Z/u, "\uDC00\uDC00Z", "\uDC00\uDC00Z"],
    // pair followed by lone trail
    [/([^"]*)Z/u, "\u{1F600}\uDC00Z", "\u{1F600}\uDC00Z"],
    // lone lead followed by pair
    [/([^"]*)Z/u, "\uD800\u{1F600}Z", "\uD800\u{1F600}Z"],
    // no match: must fully unwind
    [/([^"]*)Z/u, "\u{1F600}abc\u{1F601}", null],
    [/([^"]*)Z/u, "\u2014" + Buffer.alloc(50, "a").toString(), null],
    // match mid-string after surrogate pair boundary
    [/([^"]*?)\u{1F600}/u, "ab\u{1F600}cd", "ab\u{1F600}"],
    // greedy '+' variant
    [/([^"]+)Z/u, "\u{1F600}Z", "\u{1F600}Z"],
    [/([^"]+)Z/u, "Z", null],
    // U+F800/U+FC00 are not surrogates; backward step must agree with forward read on width
    [/([^"]*)Z/u, "Z\uF800\uFC00\uF800\uFC00", "Z"],
    [/([^"]*)Z/u, "aZ\uF800\uFC00", "aZ"],
    [/([^"]*)Z/u, "\uF800\uFC00Z", "\uF800\uFC00Z"],
    // real-world shape from @typescript-eslint JSX detection
    [/(?:^[^"'`]*<\/)|(?:^[^/]{2}.*\/>)/mu, "abc</", "abc</"],
    [/(?:^[^"'`]*<\/)|(?:^[^/]{2}.*\/>)/mu, "\u2014\nabc", null],
  ] as const)("matches %p on %p", (re, input, expected) => {
    const m = re.exec(input);
    if (expected === null) {
      expect(m).toBeNull();
    } else {
      expect(m?.[0]).toBe(expected);
    }
  });

  test("capture positions across surrogate-pair backtracking", () => {
    // Greedy class swallows the whole string then backs off 3 code points (one pair + two
    // BMP) to expose "Zq". Index must land exactly at the Z, not inside the pair.
    const m = /([^"]*)Z(.)/u.exec("a\u{1F600}bZq\u{1F601}c");
    expect(m).not.toBeNull();
    expect([m![0], m![1], m![2], m!.index]).toEqual(["a\u{1F600}bZq", "a\u{1F600}b", "q", 0]);
  });

  test("backtracking across many mixed-width code points", () => {
    // "a😀" repeated: alternating 1-unit and 2-unit code points. Z sits at the very
    // start so the greedy class must unwind every step, alternating -1 and -2.
    let body = "";
    for (let i = 0; i < 40; i++) body += "a\u{1F600}";
    const input = "Z" + body;
    const m = /([^"]*)Z/u.exec(input);
    expect(m?.[0]).toBe("Z");
    expect(m?.[1]).toBe("");
    expect(m?.index).toBe(0);
  });

  test("greedy range begins at a lone trail surrogate", () => {
    // 'q' is outside the negated class so the quantifier begins at the trail; backtracking
    // to count 0 must restore index to exactly that boundary without peeking at 'q'.
    const m = /q([^"q]*)Z/u.exec("q\uDC00aZb");
    expect([m?.[0], m?.[1], m?.index]).toEqual(["q\uDC00aZ", "\uDC00a", 0]);
    // And fully unwinding to empty:
    const m2 = /q([^"q]*)q/u.exec("q\uDC00aaq");
    expect([m2?.[0], m2?.[1]]).toEqual(["q\uDC00aaq", "\uDC00aa"]);
    expect(/q([^"q]*)Z/u.exec("q\uDC00aa")).toBeNull();
  });
});

// Uses a subprocess so debug-build overhead in this process doesn't affect the timed
// region; the JIT-generated regex code itself runs at native speed either way.
test("greedy /u character class backtracking is not O(n^3)", async () => {
  const script = `
    const s = "\\u2014" + Buffer.alloc(2000, "a").toString();
    const re = /[^"]*X/u;
    re.test("\\u2014warmup"); // compile
    const t0 = performance.now();
    const r = re.test(s);
    const dt = performance.now() - t0;
    process.stdout.write(JSON.stringify({ r, dt }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { r, dt } = JSON.parse(stdout);
  expect({ r, stderr, exitCode }).toEqual({ r: false, stderr: "", exitCode: 0 });
  // Prior to the fix this ran ~2300ms in a release build; the fixed JIT and the YARR
  // interpreter both finish this in well under 50ms. 1000ms leaves >20x headroom.
  expect(dt).toBeLessThan(1000);
});
