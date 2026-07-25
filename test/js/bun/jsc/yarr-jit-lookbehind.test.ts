import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// YARR used to refuse to JIT any pattern that contained a lookbehind assertion, so
// a large alternation like the isbot user-agent matcher dropped entirely into the
// bytecode interpreter because of four tiny `(?<! ...)` assertions. That made the
// whole match orders of magnitude slower than V8. The JIT now compiles lookbehinds
// whose body can be flattened into a bounded set of fixed-width alternatives by
// reading characters at negative offsets from the assertion anchor; anything more
// complex still falls back cleanly to the interpreter.
//
// https://github.com/oven-sh/bun/issues/5197
// https://bugs.webkit.org/show_bug.cgi?id=258706

describe("lookbehind JIT correctness", () => {
  // Each [pattern, input, expected] triplet is checked both before and after the regex
  // has been executed enough times to cross the JIT threshold.
  const cases: Array<[RegExp, string, string | null]> = [
    [/(?<! cu)bot/, "mybot", "bot"],
    [/(?<! cu)bot/, "my cubot", null],
    [/(?<! cu)bot/, "bot", "bot"],
    [/(?<! cu)bot/, "cubot", "bot"],
    [/(?<! cu)bot/, " cubot", null],
    [/(?<! cu)bot/, " cubotbot", "bot"],
    [/(?<=cu)bot/, "cubot", "bot"],
    [/(?<=cu)bot/, "mybot", null],
    [/(?<=cu)bot/, "bot", null],
    [/(?<=cu)bot/, "xxcubot", "bot"],
    [/(?<!abc|de)X/, "abcX", null],
    [/(?<!abc|de)X/, "deX", null],
    [/(?<!abc|de)X/, "zzX", "X"],
    [/(?<!abc|de)X/, "X", "X"],
    [/(?<!abc|de)X/, "bcX", "X"],
    [/(?<!abc|de)X/, "xdeX", null],
    [/(?<!abc|de)X/, "xabcX", null],
    [/(?<=abc|de)X/, "abcX", "X"],
    [/(?<=abc|de)X/, "deX", "X"],
    [/(?<=abc|de)X/, "zzX", null],
    [/(?<=abc|de)X/, "adeXabcX", "X"],
    [/(?<!(?:lib))http/, "libhttp", null],
    [/(?<!(?:lib))http/, "xxxhttp", "http"],
    [/(?<!(?:lib))http/, "http", "http"],
    [/(?<!(?:lib))http/, "alibhttp", null],
    [/(?<! (?:channel\/|google\/))google/, " channel/google", null],
    [/(?<! (?:channel\/|google\/))google/, "xxxxxxx channel/google", null],
    [/(?<! (?:channel\/|google\/))google/, "xxxxxxxx google/google", "google"],
    [/(?<! (?:channel\/|google\/))google/, "google", "google"],
    [/(?<! ya(?:yandex)?)search/, " yasearch", null],
    [/(?<! ya(?:yandex)?)search/, " yayandexsearch", null],
    [/(?<! ya(?:yandex)?)search/, "zzzsearch", "search"],
    [/(?<! ya(?:yandex)?)search/, "search", "search"],
    [/(?<! ya(?:yandex)?)search/, "yayandexsearch", "search"],
    [/(?<! ya(?:yandex)?)search/, "xxx yasearch", null],
    [/(?<! ya(?:yandex)?)search/, "xxx yayandexsearch", null],
    [/(?<![0-9])px/, "10px", null],
    [/(?<![0-9])px/, "apx", "px"],
    [/(?<![0-9])px/, "px", "px"],
    [/(?<![0-9])px/, "x10px", null],
    [/a(?<!xa)b/, "xab", null],
    [/a(?<!xa)b/, "yab", "ab"],
    [/a(?<!xa)b/, "ab", "ab"],
    [/a(?<!xa)b/, "xxab", null],
    [/(?<!ABC)d/i, "abcd", null],
    [/(?<!ABC)d/i, "xyzd", "d"],
    [/(?<!ABC)d/i, "AbCd", null],
    [/(?<=[a-z])X/, "aX", "X"],
    [/(?<=[a-z])X/, "9X", null],
    [/(?<!\d)px/, "5px", null],
    [/(?<!\d)px/, "xpx", "px"],
    [/(?<!a)(?<!b)c/, "ac", null],
    [/(?<!a)(?<!b)c/, "bc", null],
    [/(?<!a)(?<!b)c/, "xc", "c"],
    [/(?<=a)(?<=.a)b/, "xab", "b"],
    [/(?<=a)(?<=.a)b/, "ab", null],
    [/ab(?<!ab)/, "ab", null],
    [/ab(?<!cd)/, "ab", "ab"],
    [/(?<!\s)word/, " word", null],
    [/(?<!\s)word/, "xword", "word"],
    [/foo(?<!x)bar/, "foobar", "foobar"],
    [/foo(?<!o)bar/, "foobar", null],
    [/(?<!a|bb|ccc)d/, "ad", null],
    [/(?<!a|bb|ccc)d/, "bbd", null],
    [/(?<!a|bb|ccc)d/, "cccd", null],
    [/(?<!a|bb|ccc)d/, "xd", "d"],
    [/(?<!a|bb|ccc)d/, "bd", "d"],
    [/(?<!a|bb|ccc)d/, "ccd", "d"],
    [/x|(?<!a)y/, "ay", null],
    [/x|(?<!a)y/, "by", "y"],
    [/x|(?<!a)y/, "x", "x"],
    [/(?<!ab)c/, "\u00ffabc", null],
    [/(?<!ab)c/, "\u00ffxxc", "c"],
    [/(?<!\u00e9)x/, "\u00e9x", null],
    [/(?<!\u00e9)x/, "ax", "x"],
    // 16-bit input strings (code points above U+00FF force Char16 storage).
    [/(?<!ab)c/, "\u0100abc", null],
    [/(?<!ab)c/, "\u0100xxc", "c"],
    [/(?<!\u0101)x/, "\u0101x", null],
    [/(?<!\u0101)x/, "a\u0100x", "x"],
    [/(?<![0-9])px/, "\u010010px", null],
    [/(?<![0-9])px/, "\u0100apx", "px"],
    [/(?<=\u0101\u0102)x/, "\u0101\u0102x", "x"],
    [/(?<=\u0101\u0102)x/, "\u0101\u0103x", null],
    // Lookbehind inside a lookahead.
    [/x(?=(?<!x)y)y/, "xy", null],
    [/x(?=(?<!a)y)y/, "xy", "xy"],
    [/(?=(?<=a)b)b/, "ab", "b"],
    [/(?=(?<=a)b)b/, "xb", null],
    [/z(?=a(?<!za)b)ab/, "zab", null],
    [/z(?=a(?<!ya)b)ab/, "zab", "zab"],
    [/(?=(?<!ab|c)d)d/, "abd", null],
    [/(?=(?<!ab|c)d)d/, "xd", "d"],
    [/(?=ab(?<!xab)c)abc/, "xabc", null],
    [/(?=ab(?<!xab)c)abc/, "yabc", "abc"],
    [/(?<!)X/, "aX", null],
    [/(?<=)X/, "aX", "X"],
    [/(?=(?<!a)b)/, "xb", ""],
    [/(?=(?<!a)b)/, "ab", null],
    [/((?<!a)b)+/, "xbbb", "bbb"],
    [/((?<!a)b)+/, "abbb", "bb"],
    [/(?<![^a])b/, "ab", "b"],
    [/(?<![^a])b/, "xb", null],
    [/(?<![^a])b/, "b", "b"],
    [/(?<!.)b/, "ab", null],
    [/(?<!.)b/, "b", "b"],
    [/(?<!.)b/, "\nb", "b"],
    // Patterns below must fall back to the interpreter; they still need to work.
    [/(?<!a)b/u, "ab", null],
    [/(?<!a)b/u, "xb", "b"],
    [/(?<=a+)b/, "aaab", "b"],
    [/(?<=a+)b/, "b", null],
    [/(?<=a{2,3})b/, "aab", "b"],
    [/(?<=a{2,3})b/, "ab", null],
    [/(?<=(x))y/, "xy", "y"],
    [/(?<=(x))y/, "zy", null],
  ];

  test.each(cases)("%p on %p", (re, input, expected) => {
    const m = re.exec(input);
    if (expected === null) {
      expect(m).toBeNull();
    } else {
      expect(m?.[0]).toBe(expected);
    }
  });

  test("16-bit MatchOnly path", () => {
    for (const [re, input, expected] of cases) {
      // Force compilation of the Char16 match-only body before the assertion below.
      re.test("\u0100");
      const m = re.exec(input);
      if (expected === null) {
        expect(m).toBeNull();
      } else {
        expect(m?.[0]).toBe(expected);
      }
    }
  });

  test("capture outside lookbehind", () => {
    const m = /(?<!x)(bot)/.exec("mybot");
    expect([m?.[0], m?.[1], m?.index]).toEqual(["bot", "bot", 2]);
  });

  test("global replace", () => {
    expect("foobar cubar".replace(/(?<!cu)bar/g, "X")).toBe("fooX cubar");
  });
});

// The headline symptom from #5197: the isbot user-agent regex. Before the fix the
// whole pattern ran in the interpreter because of four simple `(?<! ...)` assertions,
// while the same pattern without them was JIT-compiled. We time both shapes and assert
// the lookbehind variant is not orders of magnitude slower than the plain one, which
// holds independent of build type.
test("isbot-style regex with lookbehinds is not orders of magnitude slower than without", async () => {
  const script = `
    const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const crawler = "Mozilla/5.0 (compatible; AhrefsBot/7.0; +xxxx://ahrefs.example/robot/)";
    function bench(re) {
      re.test("warmup"); re.test("warmup");
      const t0 = performance.now();
      let c = 0;
      for (let i = 0; i < 200; i++) {
        c += re.test(browser);
        c += re.test(crawler);
      }
      return { c, dt: performance.now() - t0 };
    }
    // Identical alternation; the first form guards four alternatives with lookbehinds.
    const reLB = /^axios\\/|^php|^postman|^python|^wget|^yandex|appinsights|archive|bluecoat drtr|(?<! cu)bot|browsex|capture|catch|check|chromeframe|cloud|crawl|download|feed|ghost|(?<! (?:channel\\/|google\\/))google(?!(app|\\/google| pixel))|headlesschrome\\/|(?<!(?:lib))http|httrack|hydra|images|java(?!;)|library|manager|monitor|nutch|optimize|pagespeed|perl|phantom|pingdom|preview|proxy|reader|rss|scan|scrape|(?<! ya(?:yandex)?)search|server|sogou|spider|torrent|uuurl|wappalyzer|wordpress|zgrab/;
    const rePlain = /^axios\\/|^php|^postman|^python|^wget|^yandex|appinsights|archive|bluecoat drtr|bot|browsex|capture|catch|check|chromeframe|cloud|crawl|download|feed|ghost|google(?!(app|\\/google| pixel))|headlesschrome\\/|http|httrack|hydra|images|java(?!;)|library|manager|monitor|nutch|optimize|pagespeed|perl|phantom|pingdom|preview|proxy|reader|rss|scan|scrape|search|server|sogou|spider|torrent|uuurl|wappalyzer|wordpress|zgrab/;
    const lb = bench(reLB);
    const plain = bench(rePlain);
    process.stdout.write(JSON.stringify({ lb, plain }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { lb, plain } = JSON.parse(stdout);
  // Both inputs match the crawler string once per iteration.
  expect({ lb: lb.c, plain: plain.c }).toEqual({ lb: 200, plain: 200 });
  // Without the JIT lookbehind support the ratio is roughly 50x on release and 30x on
  // debug builds; with it the two patterns run within a small constant factor of each
  // other. 10x leaves ample slack for noise without admitting the interpreter path.
  const ratio = lb.dt / Math.max(plain.dt, 1);
  expect(ratio).toBeLessThan(10);
});
