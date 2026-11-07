// Stage-D verification corpus: prints one canonical line per case. Compare
// across engines (node, stock bun, our jsc jit/interp) with diff.
const out = typeof print === "function" ? print : console.log;
const fmt = m => (m === null ? "null" : JSON.stringify([...m].map(v => (v === undefined ? null : v))) + "@" + m.index);
const ex = (re, s) => { try { return fmt(re.exec(s)); } catch (e) { return "THROW " + e.constructor.name; } };
const all = (src, flags, s) => {
  try {
    const re = new RegExp(src, flags.includes("g") ? flags : flags + "g");
    const r = []; let m, n = 0;
    while ((m = re.exec(s)) !== null && n++ < 20) { r.push(fmt(m)); if (m[0] === "") re.lastIndex++; }
    return "[" + r.join(",") + "]";
  } catch (e) { return "THROW " + e.constructor.name; }
};
const rows = [];
const row = (label, v) => rows.push(label.padEnd(70) + " " + v);

// ===== BOL over-match family (last night's regression shapes) =====
row("bol A /.(^)X/ aX", ex(/.(^)X/, "aX"));
row("bol A2 /.(^)X/ ^-at-0 XX", ex(/(^)X/, "XX"));
row("bol B /y(^\\S{2})/ ayzz", ex(/y(^\S{2})/, "ayzz"));
row("bol C \\w(?=^[dby]?) ab", ex(/\w(?=^[dby]?)/, "ab"));
row("bol D [^sc](?<a>^) qx", ex(/[^sc](?<a>^)/, "qx"));
row("bol E 9{2}(?=^\\b\\B)0 x990", ex(/9{2}(?=^\b\B)0/, "x990"));
row("bol F c(?:^(?:x)) acx", ex(/c(?:^(?:x))/, "acx"));
row("bol G b[^xy](?:^\\n?)/y bqz", (() => { const r = /b[^xy](?:^\n?)/y; r.lastIndex = 0; return ex(r, "bqz"); })());
row("bol H (\\w(^)\\s|$)/i 'a x'", ex(/\w(^)\s|$/i, "a x"));
// ===== upstream bug #1 family (optional / quantified anchors) =====
row("opt (?:^)?a ba", ex(/(?:^)?a/, "ba"));
row("opt (^)*a ba", ex(/(^)*a/, "ba"));
row("opt \\B(?:^)? xx", ex(/\B(?:^)?/, "xx"));
row("opt (?:^b)?a ba", ex(/(?:^b)?a/, "ba"));
row("opt (?:^)?a global 'aba'", all("(?:^)?a", "", "aba"));
row("opt (^){0,2}z yz", ex(/(^){0,2}z/, "yz"));
row("neg-assert-anchor (?!^)a ba", ex(/(?!^)a/, "ba"));
row("pos-assert-anchor (?=^)a ba", ex(/(?=^)a/, "ba"));
row("anchored control ^a ba", ex(/^a/, "ba"));
row("anchored control (?:^a) ba", ex(/(?:^a)/, "ba"));
row("anchored control (^a)+ ba", ex(/(^a)+/, "ba"));
row("anchored control (?:^a|^b) cb", ex(/(?:^a|^b)/, "cb"));
row("mixed (?:^a|b) xb", ex(/(?:^a|b)/, "xb"));
row("mixed global (?:^a|a) 'aa'", all("(?:^a|a)", "", "aa"));
row("group-then-more x(?:^|y)z 'xyz'", ex(/x(?:^|y)z/, "xyz"));
row("required-group (?:^)a ba (must be null)", ex(/(?:^)a/, "ba"));
row("required-group2 (?:^|^)a ba (null)", ex(/(?:^|^)a/, "ba"));

// ===== unicode lookbehind: astral literals =====
const G = "\u{1F600}"; // grinning face
const D = "\u{1F436}"; // dog
row("u lit (?<=😀)a", ex(new RegExp("(?<=" + G + ")a", "u"), "xx" + G + "a"));
row("u lit neg (?<!😀)a on 😀a", ex(new RegExp("(?<!" + G + ")a", "u"), G + "a"));
row("u lit neg (?<!😀)a on 🐶a", ex(new RegExp("(?<!" + G + ")a", "u"), D + "a"));
row("u lit run (?<=😀{2})a", ex(new RegExp("(?<=" + G + "{2})a", "u"), "z" + G + G + "a"));
row("u lit run short (?<=😀{2})a one 😀", ex(new RegExp("(?<=" + G + "{2})a", "u"), "z" + G + "a"));
row("u lit greedy (?<=😀+)a global", all("(?<=" + G + "+)a", "u", "a" + G + G + "a"));
row("u lit lazy (?<=😀+?)a", ex(new RegExp("(?<=" + G + "+?)a", "u"), G + G + "a"));
row("u lit start (?<=😀)a at start (no room)", ex(new RegExp("(?<=" + G + ")a", "u"), "a"));
row("u mixed (?<=x😀y)!", ex(new RegExp("(?<=x" + G + "y)!", "u"), "px" + G + "y!"));
// ===== unicode lookbehind: classes =====
row("u dot (?<=.)a on 😀a", ex(new RegExp("(?<=.)a", "u"), G + "a"));
row("u dot (?<=..)a on x😀a", ex(new RegExp("(?<=..)a", "u"), "x" + G + "a"));
row("u dot (?<=..)a on 😀😀a", ex(new RegExp("(?<=..)a", "u"), G + G + "a"));
row("u negclass (?<=[^q])a on 😀a", ex(new RegExp("(?<=[^q])a", "u"), G + "a"));
row("u astral-class (?<=[😀🐶])a", ex(new RegExp("(?<=[" + G + D + "])a", "u"), "z" + D + "a"));
row("u astral-class miss", ex(new RegExp("(?<=[" + G + "])a", "u"), "z" + D + "a"));
row("u prop (?<=\\p{Emoji_Presentation})a", ex(new RegExp("(?<=\\p{Emoji_Presentation})a", "u"), "q" + G + "a"));
row("u prop-neg (?<=\\P{L}{2})a", ex(new RegExp("(?<=\\P{L}{2})a", "u"), "b1" + G + "a"));
row("u varclass greedy (?<=[😀x]*)a", ex(new RegExp("(?<=[" + G + "x]*)a", "u"), "q" + G + "x" + G + "a"));
row("u varclass fixed3 (?<=[😀x]{3})a ok", ex(new RegExp("(?<=[" + G + "x]{3})a", "u"), "q" + G + "xxa"));
row("u varclass fixed3 (?<=[😀x]{3})a via astral", ex(new RegExp("(?<=[" + G + "x]{3})a", "u"), "qx" + G + "xa"));
row("u varclass lazy (?<=[😀x]{2,}?)a", ex(new RegExp("(?<=[" + G + "x]{2,}?)a", "u"), G + "x" + G + "a"));
row("u dot capture (?<=(.)(.))!", ex(new RegExp("(?<=(.)(.))!", "u"), "a" + G + "!"));
// ===== unicode: lone surrogates in subject =====
row("u lone-trail (?<=\\uDE00)a", ex(new RegExp("(?<=\\uDE00)a", "u"), "\uDE00a"));
row("u lone-lead (?<=\\uD83D)a", ex(new RegExp("(?<=\\uD83D)a", "u"), "\uD83Da"));
row("u trail-of-pair not lone (?<=\\uDE00)a on 😀a", ex(new RegExp("(?<=\\uDE00)a", "u"), G + "a"));
row("u dot before lone trail", ex(new RegExp("(?<=.)a", "u"), "x\uDE00a"));
row("u class over lone lead", ex(new RegExp("(?<=[\\uD800-\\uDBFF])a", "u"), "\uD83Da"));
row("u class surrogate-range vs pair", ex(new RegExp("(?<=[\\uD800-\\uDBFF])a", "u"), G + "a"));
// ===== unicode: ignoreCase =====
row("iu lit (?<=k)a on Ka", ex(/(?<=k)a/iu, "Ka"));
row("iu class (?<=[a-z])1", ex(/(?<=[a-z])1/iu, "B1"));
row("iu astral no-fold (?<=😀)a", ex(new RegExp("(?<=" + G + ")a", "iu"), G + "a"));
row("iu deseret fold (?<=\\u{10400})x", ex(new RegExp("(?<=\\u{10400})x", "iu"), "\u{10428}x"));
row("iu long-s (?<=s)!", ex(/(?<=s)!/iu, "ſ!"));
row("iu kelvin (?<=k)!", ex(/(?<=k)!/iu, "K!"));
// ===== the /v flag =====
row("v lit (?<=😀)a", ex(new RegExp("(?<=" + G + ")a", "v"), "z" + G + "a"));
row("v class-string (?<=[\\q{ab|c}])!", ex(new RegExp("(?<=[\\q{ab|c}])!", "v"), "xab!"));
row("v dot (?<=.)a on 😀a", ex(new RegExp("(?<=.)a", "v"), G + "a"));
row("v setops (?<=[\\p{L}--[a]])!", ex(new RegExp("(?<=[\\p{L}--[a]])!", "v"), "b!"));
// ===== \b under unicode in backward body =====
row("u wb (?<=\\b)x 'ax x'", all("(?<=\\b)x", "u", "ax x"));
row("u wb (?<=a\\b)!", ex(/(?<=a\b)!/u, "a!"));
row("u nwb (?<=\\B)x", all("(?<=\\B)x", "u", "ax x"));
row("u wb astral (?<=😀\\b)! (astral not word)", ex(new RegExp("(?<=" + G + "\\b)!", "u"), G + "!"));
row("iu wb kelvin (?<=\\b)K", ex(/(?<=\b)!/iu, "K!"));
// ===== BOL/EOL inside backward body under unicode =====
row("u bol-in-lb (?<=^😀)a", ex(new RegExp("(?<=^" + G + ")a", "u"), G + "a"));
row("u bol-in-lb miss (?<=^😀)a", ex(new RegExp("(?<=^" + G + ")a", "u"), "z" + G + "a"));
row("mu eol-in-lb (?<=x$\\n?)y", ex(/(?<=x$\n?)y/mu, "x\ny"));
// ===== backreferences in body (both directions) =====
row("bref (?<=(a)\\1)x on aax", ex(/(?<=(a)\1)x/, "aax"));
row("bref (?<=\\1(a))x fwdref", ex(/(?<=\1(a))x/, "aax"));
row("bref-astral (?<=(😀)\\1)x", ex(new RegExp("(?<=(" + G + ")\\1)x", "u"), G + G + "x"));
row("bref-counted (?<=(ab)\\1{2})!", ex(/(?<=(ab)\1{2})!/, "ababab!"));
row("bref-greedy (?<=(a)\\1*)!", ex(/(?<=(a)\1*)!/, "aaaa!"));
row("bref-lazy (?<=(a)\\1*?)!", ex(/(?<=(a)\1*?)!/, "aaaa!"));
row("bref-named (?<=(?<q>b)\\k<q>)!", ex(/(?<=(?<q>b)\k<q>)!/, "bb!"));
row("bref-ic (?<=(a)\\1)!/iu", ex(/(?<=(a)\1)!/iu, "aA!"));
row("bref-mismatch (?<=(a)\\1)! on ab!", ex(/(?<=(a)\1)!/, "ab!"));
// ===== quantified groups in body =====
row("grp (?<=(?:ab)+)!", ex(/(?<=(?:ab)+)!/, "ababab!"));
row("grp global (?<=(?:ab)+)!", all("(?<=(?:ab)+)!", "", "ab!abab!x!"));
row("grp {2} (?<=(?:ab){2})!", ex(/(?<=(?:ab){2})!/, "abab!"));
row("grp {2} short (?<=(?:ab){2})! on ab!", ex(/(?<=(?:ab){2})!/, "ab!"));
row("grp {1,2} (?<=(?:ab){1,2})!", ex(/(?<=(?:ab){1,2})!/, "abab!"));
row("grp lazy (?<=(?:ab)+?)!", ex(/(?<=(?:ab)+?)!/, "abab!"));
row("grp opt (?<=x(?:ab)?)!", ex(/(?<=x(?:ab)?)!/, "xab!"));
row("grp opt none (?<=x(?:ab)?)!", ex(/(?<=x(?:ab)?)!/, "x!"));
row("grp alt (?<=(?:ab|cde)+)!", ex(/(?<=(?:ab|cde)+)!/, "cdeabab!"));
row("grp cap (?<=(a)+)!", ex(/(?<=(a)+)!/, "aaa!"));
row("grp cap-idx (?<=(a|b)+)!/d", (() => { const m = /(?<=(a|b)+)!/d.exec("aba!"); return m ? JSON.stringify(m.indices) : "null"; })());
row("grp nested (?<=(?:(?:xy)+z)+)!", ex(/(?<=(?:(?:xy)+z)+)!/, "xyxyzxyz!"));
row("grp astral (?<=(?:😀y)+)!", ex(new RegExp("(?<=(?:" + G + "y)+)!", "u"), G + "y" + G + "y!"));
row("grp neg (?<!(?:ab)+)!", ex(/(?<!(?:ab)+)!/, "xy!"));
row("grp neg miss (?<!(?:ab)+)!", ex(/(?<!(?:ab)+)!/, "abab!"));
// ===== nested assertions =====
row("la-in-lb (?<=(?=a)a)x", ex(/(?<=(?=a)a)x/, "ax"));
row("la-in-lb2 (?<=a(?=.x))x", ex(/(?<=a(?=.x)).x/, "a1x"));
row("negla-in-lb (?<=a(?!b))c", ex(/(?<=a(?!b))c/, "ac"));
row("negla-in-lb miss (?<=a(?!c))c", ex(/(?<=a(?!c))c/, "ac"));
row("lb-in-lb (?<=(?<=a)b)c", ex(/(?<=(?<=a)b)c/, "abc"));
row("lb-in-la (?=(?<=a)b) on ab", ex(/(?=(?<=a)b)/, "ab"));
row("la-in-lb-u (?<=(?=😀)😀)x", ex(new RegExp("(?<=(?=" + G + ")" + G + ")x", "u"), G + "x"));
row("la-in-lb capture (?<=(?=(a))a)x", ex(/(?<=(?=(a))a)x/, "ax"));
// ===== sticky / global / lastIndex interplay =====
row("y sticky (?<=a)b at 1", (() => { const r = /(?<=a)b/y; r.lastIndex = 1; return ex(r, "ab"); })());
row("y sticky miss (?<=a)b at 0", (() => { const r = /(?<=a)b/y; r.lastIndex = 0; return ex(r, "ab"); })());
row("gu astral (?<=😀). all", all("(?<=" + G + ").", "u", G + "a" + G + "b"));
row("empty-match lb global (?<=a)", all("(?<=a)", "", "aaa"));
for (const r of rows) out(r);
