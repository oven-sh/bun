// Every match of these patterns holds some text, or seems to. Each is searched for in subjects where that text is absent, at the start, at the end,
// parted by a surrogate pair, in the other case, too far behind the start, there twice. The answer is held to that of the same pattern with the flag y,
// tried at one place after another as RegExpBuiltinExec does.

const say = typeof console === "object" ? text => console.log(text) : print;

const pair = String.fromCodePoint(0x1f600);
const otherPair = String.fromCodePoint(0x1f64f);
const lead = pair[0];
const trail = pair[1];
const longS = String.fromCharCode(0x17f);
const kelvin = String.fromCharCode(0x212a);
const micro = String.fromCharCode(0xb5);
const mu = String.fromCharCode(0x3bc);
const eAcute = String.fromCharCode(0xe9);
const eAcuteUpper = String.fromCharCode(0xc9);

// [pattern, pieces that fit or nearly fit]
const rows = [
  [
    /\b([a-z0-9-]{1,64}@[a-z0-9-]+\.example\.invalid)\b/i,
    [
      "ab-1@host.example.invalid",
      "AB@H.EXAMPLE.INVALID",
      "ab@host.example.invalif",
      "ab.example.invalid",
      "@h.example.invalid",
      "a@.example.invalid",
    ],
  ],
  [
    /[a-z]{1,64}@/,
    ["a@", "@", "abc@", "A@", "a".repeat(63) + "@", "a".repeat(64) + "@", "a".repeat(65) + "@", "a".repeat(130) + "@"],
  ],
  [/[a-z]{1,64}?@/, ["a@", "a".repeat(64) + "@", "a".repeat(66) + "@"]],
  [/[a-z]{2,5}@[a-z]/g, ["a@b", "ab@c", "abcdefg@h", "ab@", "ab@@c"]],
  [/\d+:\/\/\w+/, ["1://a", "12:/a", "12://", "://a", "9:// 8://b"]],
  [/\w+\.example\.com/, ["a.example.com", "a.example.co", ".example.com", "a.EXAMPLE.com", "a.example.example.com"]],
  [/\w+\.example\.com/i, ["a.example.com", "a.EXAMPLE.COM", "A.eXaMpLe.CoM", "a.example" + kelvin + "com"]],
  [/\w*#/, ["#", "a#", "a"]],
  [/x*y*#z/, ["#z", "xy#z", "xxyy#", "#"]],
  [/[a-z]+@[a-z]+/, ["a@b", "ab cd@ef", "@b", "a@", "a@@b", "a b@c d@e", "A@b"]],
  [/[a-z]{3,}@/, ["ab@", "abc@", "ab@abc@", "a b@abcd@", "abc @"]],
  [/(?:[a-z]+-)*[a-z]+@x/, ["a@x", "a-b@x", "a--b@x", "-a@x", "a-b-c@x", "a b-c@x"]],
  [/(?:ab|cd)+=\d/, ["ab=1", "abcd=2", "abc=3", "xab=4", "ab =5", "cdab=6"]],
  [/(\w)\1*:x/, ["a:x", "aa:x", "ab:x", "b aa:x"]],
  [/(?<=\s)\w+:x/, [" a:x", "a:x", "b a:x", "  ab:x"]],
  [/(?<!-)\b\w+:x/, ["a:x", "-a:x", "b-a:x", "a a:x"]],
  [/[^\s:]+:x/, ["a:x", " :x", "a b:x", pair + ":x", "a" + pair + "b:x", lead + ":x"]],
  [/[^\s:]+:x/u, ["a:x", "a b:x", pair + ":x", "a" + pair + "b:x", " " + pair + ":x", lead + ":x", trail + ":x"]],
  [/\w+?:x/, ["a:x", "ab:x", "a b:x"]],
  [/\w+\s*=\s*\d/, ["a=1", "a = 1", "a  =2", "a b = 3", "= 4", "a\n=\n5"]],
  [/[a-z]+\d*#/i, ["a#", "A1#", "a12#", "1#", "a 1#", "a1 b2#"]],
  [/.+;x/, ["a;x", ";x", "a\nb;x", "a;b;x"]],
  [/^a|\w+@x/, ["a", "b@x", "ab@x", "c b@x", " a"]],
  [/\w+@x|\w+#y/, ["a@x", "a#y", "a@y", "b a#y"]],
  [/[a-z]{2}[a-z]*@@/, ["ab@@", "a@@", "a@@ab@@", "abc@ @@", "ab@@@"]],
  [/(?:foo@|bar)baz/, ["foo@baz", "barbaz", "foobaz", "bar@baz"]],
  [/a(?:@)?b/, ["ab", "a@b", "a@@b"]],
  [/a@*b/, ["ab", "a@b", "a@@@b"]],
  [/a@{0,3}b/, ["ab", "a@@@b", "a@@@@b"]],
  [/a@{2,3}b/, ["a@b", "a@@b", "a@@@b", "a@@@@b"]],
  [/(?:@|)x/, ["x", "@x"]],
  [/x|y@/, ["x", "y@", "y", "@"]],
  [/\w+=|\w+:/, ["a=", "a:", "a", "=", "ab:c="]],
  [/(?:key|word|name)\s*[=:]\s*(\S+)/i, ["key=1", "WORD : two", "name", "name=", "keyword:3"]],
  [/(?:a|b@)+c/, ["ac", "b@c", "ab@ac", "bc", "b@"]],
  [/(?:ab@){2,3}/, ["ab@", "ab@ab@", "ab@ab@ab@ab@"]],
  [/(?:[a-z]@){2}!/, ["a@b@!", "a@!", "a@b@"]],
  [/(a+|b)\1@/, ["aa@", "bb@", "a@", "aaaa@", "ab@"]],
  [/(x*)\1{2}@end/, ["@end", "xxx@end", "xx@end", "xxxxxx@en"]],
  [/(?<q>['"])[^'"]*\k<q>;/, ["'a';", '"";', "'a\";", "'a'"]],
  [/(?=.*@)\w+/, ["ab @", "ab", "@"]],
  [/\w+(?=@)/, ["ab@", "ab", "@"]],
  [/\w+(?!@)/, ["ab@", "a@", "ab"]],
  [/a(?!@)/, ["a", "a@", "a@a"]],
  [/(?<=@)\w+/, ["@ab", "ab", "@"]],
  [/(?<!@)\b\w+/, ["@ab", "ab", "@a b"]],
  [/(?<=#[a-z]{0,3})%/, ["#%", "#abc%", "#abcd%", "%"]],
  [/^a@|b#/, ["a@", "b#", "xa@", "a#"]],
  [/^a@|^b#/, ["a@", "b#", "xa@"]],
  [/^@/m, ["@", "\n@", "a@"]],
  [/(?:^|,)x@/, ["x@", ",x@", "ax@"]],
  [/[a-z]+@$/, ["a@", "a@ ", "a@\n"]],
  [/[a-z]+@$/m, ["a@", "a@ ", "a@\nb"]],
  [/@[a-z]{3}$/, ["@abc", "@abcd", "@ab"]],
  [/.*@.*/, ["a@b", "@", "a\n@\nb"]],
  [/^.*foo@.*$/m, ["a foo@ b", "foo@", "fo@"]],
  [/.+@/s, ["a@", "\n@", "@"]],
  [/[^@]+@[^@]+/, ["a@b", "@b", "a@", "a@@b"]],
  [/[^a]{1,3}~/, ["b~", "a~", "bbbb~", "~"]],
  [/[\s\S]{0,4}\|/, ["|", "abcd|", "abcdef|"]],
  [/\S{3}\t/, ["abc\t", "ab\t", "abcd\t"]],
  [/(?i:ab)@c/, ["ab@c", "AB@c", "ab@C"]],
  [/a(?-i:B)@/i, ["aB@", "AB@", "ab@"]],
  [/[a-z]+Q/, ["aQ", "aq", "Q"]],
  [/[a-z]+q/i, ["aQ", "aq", "AQ", "q"]],
  [/\d+sk@/iu, ["1sk@", "1SK@", "1" + longS + kelvin + "@", "1s@"]],
  [/\d+sk@/i, ["1sk@", "1SK@", "1" + longS + kelvin + "@"]],
  [/x{1,3}kelvin/iu, ["xkelvin", "xx" + kelvin + "elvin", "xxxxKELVIN", "xelvin"]],
  [/\d\xb5@/iu, ["1" + micro + "@", "1" + mu + "@", "1@"]],
  [/\d\xe9@/i, ["1" + eAcute + "@", "1" + eAcuteUpper + "@", "1e@"]],
  [
    /.{1,3}@/u,
    [
      "a@",
      pair + "@",
      pair + pair + pair + "@",
      pair + pair + pair + pair + "@",
      "a" + pair + "b" + pair + "@",
      trail + "@",
      lead + "@",
      "@",
    ],
  ],
  [/.{1,3}@/, ["a@", pair + "@", pair + pair + "@", "abcd@"]],
  [
    /[\u{1f600}-\u{1f64f}]{1,3}@x/u,
    [pair + "@x", pair + otherPair + pair + "@x", pair + pair + pair + pair + "@x", lead + "@x", trail + "@x", "@x"],
  ],
  [
    /[\u{1f600}-\u{1f64f}a]{2}#/u,
    [pair + "a#", "a" + pair + "#", pair + pair + "#", "aa#", "a#", pair + pair + pair + "#"],
  ],
  [/\u{1f600}+!/u, [pair + "!", pair + pair + "!", lead + "!", trail + "!", "!"]],
  [/[^\u{1f600}]{2}!/u, ["ab!", otherPair + "a!", pair + "a!", otherPair + otherPair + "!", trail + "a!"]],
  [/\P{L}{2}%/u, ["12%", pair + "1%", "a1%", pair + pair + "%"]],
  [/a\u{1f600}?b;/u, ["ab;", "a" + pair + "b;", "a" + lead + "b;"]],
  [/ab;/u, ["ab;", "a" + pair + "b;", "a" + trail + "b;"]],
  [/ab;/, ["ab;", "a" + pair + "b;", "AB;"]],
  [/\ud83d@/, [lead + "@", pair + "@", "@"]],
  [/\ud83d@/u, [lead + "@", pair + "@", "@"]],
  [/\ude00@/u, [trail + "@", pair + "@", lead + trail + "@"]],
  [/\B@|aa/u, ["@", "a@", pair + "@", "aa"]],
  [/[\q{ab|c}]@/v, ["ab@", "c@", "b@", "a@"]],
  [/[\q{ab|c|}]@/v, ["ab@", "@", "a@"]],
  [/\p{RGI_Emoji}{1,2}@/v, [pair + "@", pair + pair + pair + "@", "a@"]],
  [/[[a-z]--[aeiou]]+@/v, ["bcd@", "a@", "ba@"]],
  [/[a-z]+@/y, ["a@", "1a@"]],
  [/[a-z]+@/gy, ["a@", "1a@", "a@b@"]],
  [/(?:)@?/, ["@", ""]],
  [/[]@/, ["@"]],
  [/[^]@/, ["a@", "@", "\n@"]],
  [/a{0}@b/, ["@b", "a@b"]],
  [/(?:a{40}){2}@/, ["a".repeat(80) + "@", "a".repeat(79) + "@", "a".repeat(81) + "@"]],
  [/(?:[a-c]{1,3}){1,3}@/, ["abc@", "a".repeat(9) + "@", "a".repeat(10) + "@", "a".repeat(14) + "@"]],
  [/((((((((((((((((((((((((((a@))))))))))))))))))))))))))/, ["a@", "a"]],
  [/-{5}BEGIN [A-Z ]+-{5}/, ["-----BEGIN A B-----", "----BEGIN A-----", "-----BEGIN -----", "-----begin A-----"]],
  [/\b[A-Za-z0-9_]{4}-[A-Za-z0-9_]{4}\b/, ["abcd-efgh", "abc-defg", "abcde-fghi", "abcd-efg"]],
  [/"[^"\n]*":\s*\[/, ['"a": [', '"":[', '"a" [', '"a":']],
  [/<([a-z]+)>[^<]*<\/\1>/, ["<a>x</a>", "<a>x</b>", "<a></a>", "<a>x<a>"]],
  [/\$\{[^}]*\}/, ["${a}", "${}", "$a}", "${a"]],
  [/[0-9a-f]{8}-[0-9a-f]{4}/i, ["0123abcd-89EF", "0123abc-89ef", "0123abcd_89ef"]],
  [/^(?i:get|put) \/[a-z]+ @1$/, ["get /a @1", "PUT /ab @1", "xget /a @1", "get /a @2"]],
  [/^(?i:a)#|b+%/, ["a#", "A#", "xa#", "b%", "a#b%", "xbb%"]],
  [/^(?i:a)+$|b+$/, ["a", "Aa", "b", "ab", "xa", "abb"]],
  [/[ \t]+$/, [" ", " \t ", " a", "a  "]],
  [/^[ \t]+|[ \t]+$/g, [" ", " a ", "  a", "a  ", " a b  "]],
  [
    /^[ \t\xa0\u2003\ufeff]+|[ \t\xa0\u2003\ufeff]+$/g,
    [" ", " a ", "a " + String.fromCharCode(0x2003), String.fromCharCode(0xa0) + "a" + String.fromCharCode(0xfeff, 32)],
  ],
  [/[\s,]+$/, [",", ", ,", ",a", "a,\n"]],
  [/\d+px$/, ["1px", "12px", "1px ", "px", "1p"]],
  [/\w+@\w+$/, ["a@b", "a@b ", "a@", "x a@b"]],
  [/(?:ab|c)+$/, ["ab", "cab", "abx", "xabc"]],
  [/(a|b)\1$/, ["aa", "ab", "bb", "aab"]],
  [/x*$/, ["x", "xx", "xa", ""]],
  [/[^a]+$/u, ["b", pair, "a" + pair, pair + "a", "a" + trail, "a" + lead + "b"]],
  [/[\u{1f600}x]+$/u, [pair, "x" + pair, pair + "x", lead, trail + "x", "a" + pair]],
  [/.+$/, ["a", "a\nb", "a\n"]],
  [/.+$/s, ["a", "a\nb", "\n"]],
  [/\S+\s*$/, ["a", "a  ", "a b ", " "]],
  [/(?<=a)b+$/, ["ab", "abb", "bb", "cb", "ab "]],
  [/\bfoo\d*$/i, ["foo", "FOO12", "xfoo", "foo1a"]],
  [/[a-z]+$/m, ["a", "a\n1", "1\na"]],
  [/a+$|b+$/, ["a", "b", "ab", "ba", "a "]],
  [/a+$|b/, ["a", "b", "ab ", "a "]],
  [/^a+$|b+$/, ["a", "b", "ab", "xa", "aab"]],
  [/(?=[a-z]+$)\w+$/, ["ab", "a1", "1a"]],
  [/[a-z]*(?!x)$/, ["ab", "", "1"]],
];

const fillers = [
  "",
  " ",
  "x",
  "0123456789abcde",
  "0123456789abcdefg",
  "the quick brown fox jumps over the lazy dog ",
  "z".repeat(70),
];
const wideFillers = [
  pair,
  lead,
  trail,
  "a" + pair + " " + otherPair + " ",
  String.fromCharCode(0x3b1) + " ",
  ("w " + pair).repeat(9),
];
const narrowFillers = [micro + " ", (eAcute + "n ").repeat(12)];

function subjectsOf(pieces) {
  const subjects = new Set(fillers);
  for (const piece of pieces) {
    for (const filler of fillers) {
      subjects.add(piece + filler);
      subjects.add(filler + piece);
    }
    for (const filler of [fillers[1], fillers[3], fillers[5], fillers[6], ...wideFillers, ...narrowFillers]) {
      subjects.add(filler + piece + filler);
      subjects.add(filler + piece + filler + pieces[0] + filler);
    }
    subjects.add(fillers[5] + piece.toUpperCase() + fillers[1]);
    subjects.add(wideFillers[3] + piece.toUpperCase());
    if (piece.length > 1) {
      const half = piece.length >> 1;
      subjects.add(piece.slice(0, half) + pair + piece.slice(half));
      subjects.add(fillers[5] + piece.slice(0, half) + fillers[5] + piece.slice(half));
    }
  }
  return [...subjects];
}

function startsOf(subject) {
  const starts = new Set([0, 1, 2, subject.length >> 1, subject.length - 1, subject.length]);
  return [...starts].filter(start => start >= 0 && start <= subject.length);
}

function describe(match, lastIndex) {
  if (!match) return "null " + lastIndex;
  return (
    match.index +
    " " +
    lastIndex +
    " " +
    JSON.stringify(Array.from(match)) +
    (match.groups ? JSON.stringify(match.groups) : "")
  );
}

// What the pattern with the flag y finds at each place of the subject, and from there what a search from any place finds.
class PlaceByPlace {
  constructor(pattern, subject) {
    const tried = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "") + "y");
    this.subject = subject;
    this.isSticky = pattern.sticky;
    this.isUnicode = pattern.unicode || pattern.unicodeSets;
    this.matches = [];
    for (let at = 0; at <= subject.length; ++at) {
      tried.lastIndex = at;
      this.matches.push(tried.exec(subject));
    }
  }

  behind(at) {
    const unit = this.subject.charCodeAt(at);
    const next = this.subject.charCodeAt(at + 1);
    return at + (this.isUnicode && unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1);
  }

  from(start) {
    for (let at = start; at <= this.subject.length; at = this.behind(at)) {
      if (this.matches[at] || this.isSticky) return this.matches[at];
    }
    return null;
  }

  replaced() {
    let result = "";
    let copied = 0;
    for (let from = 0; from <= this.subject.length; ) {
      const match = this.from(from);
      if (!match) break;
      result += this.subject.slice(copied, match.index) + "[" + match[0].length + "]";
      copied = match.index + match[0].length;
      from = match[0].length ? copied : this.behind(copied);
    }
    return result + this.subject.slice(copied);
  }
}

let hash = 0;
let searches = 0;
let found = 0;
const differences = [];

function note(text) {
  for (let i = 0; i < text.length; ++i) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
}

function hold(what, pattern, subject, start, answer, expected) {
  ++searches;
  note(answer);
  if (answer !== expected && differences.length < 20)
    differences.push(`${what} ${pattern} on ${JSON.stringify(subject)} from ${start}: ${answer}, expected ${expected}`);
}

function run(pattern, subject, expected) {
  const whole = expected.from(0);
  if (!pattern.global && !pattern.sticky) {
    /(marker)/.exec("a marker");
    hold("exec", pattern, subject, 0, describe(pattern.exec(subject), 0), describe(whole, 0));
    hold("test", pattern, subject, 0, String(pattern.test(subject)), String(!!whole));
    hold("search", pattern, subject, 0, String(subject.search(pattern)), String(whole ? whole.index : -1));
    if (!whole)
      hold("statics", pattern, subject, 0, RegExp.lastMatch + RegExp.$1 + RegExp.leftContext, "markermarkera ");
    found += !!whole;
    return;
  }
  for (const start of startsOf(subject)) {
    const match = expected.from(start);
    pattern.lastIndex = start;
    const answer = pattern.exec(subject);
    hold(
      "exec",
      pattern,
      subject,
      start,
      describe(answer, pattern.lastIndex),
      describe(match, match ? match.index + match[0].length : 0),
    );
  }
  pattern.lastIndex = 0;
  if (!pattern.sticky)
    hold(
      "replace",
      pattern,
      subject,
      0,
      subject.replace(pattern, text => "[" + text.length + "]"),
      expected.replaced(),
    );
}

for (const [pattern, pieces] of rows) {
  const made = new RegExp(pattern.source, pattern.flags);
  const walking = new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
  for (const subject of subjectsOf(pieces)) {
    const expected = new PlaceByPlace(pattern, subject);
    run(pattern, subject, expected);
    run(made, subject, expected);
    run(walking, subject, expected);
  }
}

for (const difference of differences) say(difference);
say(
  `${rows.length} patterns, ${searches} searches, ${found} found, ${differences.length ? "DIFFERENT" : "same"}, ${hash >>> 0}`,
);
if (differences.length) throw new Error("a search differs from the pattern tried at one place after another");
