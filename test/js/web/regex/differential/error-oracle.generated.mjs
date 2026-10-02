// GENERATED: node/V8 outcomes for error-corpus.mjs (regen: node run-error-corpus.mjs).
// Key = JSON.stringify([source, flags]); value = {error} or {string,flags}.
export const oracle = {
 "[\"(\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\")\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(a\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?:\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<>a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<a b>c)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<1a>x)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<a>x)(?<a>y)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<a>x)|(?<a>y)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<a>x)\\\\k<b>\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\k<a>\",\"\"]": {
  "string": "/\\k<a>/",
  "flags": ""
 },
 "[\"(?<a>x)\\\\k<a>\",\"\"]": {
  "string": "/(?<a>x)\\k<a>/",
  "flags": ""
 },
 "[\"(?<a>x)\\\\k<a>\",\"u\"]": {
  "string": "/(?<a>x)\\k<a>/u",
  "flags": "u"
 },
 "[\"(?=a)+\",\"\"]": {
  "string": "/(?=a)+/",
  "flags": ""
 },
 "[\"(?=a)+\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"(?<=a)*\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a(?\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"*\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"+\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"?\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a**\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a{2,1}\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a{1,2\",\"\"]": {
  "string": "/a{1,2/",
  "flags": ""
 },
 "[\"{1}\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a{,5}\",\"\"]": {
  "string": "/a{,5}/",
  "flags": ""
 },
 "[\"a{,5}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"a{99999999999999999999}\",\"\"]": {
  "string": "/a{99999999999999999999}/",
  "flags": ""
 },
 "[\"a{2}{3}\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"a???\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"x{1,3}?\",\"\"]": {
  "string": "/x{1,3}?/",
  "flags": ""
 },
 "[\"(?:){2,}\",\"\"]": {
  "string": "/(?:){2,}/",
  "flags": ""
 },
 "[\"\\\\p\",\"\"]": {
  "string": "/\\p/",
  "flags": ""
 },
 "[\"\\\\p\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\p{Foo}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\p{L}\",\"\"]": {
  "string": "/\\p{L}/",
  "flags": ""
 },
 "[\"\\\\p{L}\",\"u\"]": {
  "string": "/\\p{L}/u",
  "flags": "u"
 },
 "[\"\\\\P{Script=Greek}\",\"u\"]": {
  "string": "/\\P{Script=Greek}/u",
  "flags": "u"
 },
 "[\"\\\\c\",\"\"]": {
  "string": "/\\c/",
  "flags": ""
 },
 "[\"\\\\c\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\c1\",\"\"]": {
  "string": "/\\c1/",
  "flags": ""
 },
 "[\"\\\\ca\",\"\"]": {
  "string": "/\\ca/",
  "flags": ""
 },
 "[\"\\\\x\",\"\"]": {
  "string": "/\\x/",
  "flags": ""
 },
 "[\"\\\\x\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\xzz\",\"\"]": {
  "string": "/\\xzz/",
  "flags": ""
 },
 "[\"\\\\xzz\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\u\",\"\"]": {
  "string": "/\\u/",
  "flags": ""
 },
 "[\"\\\\u\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\uzzzz\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\u{}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\u{110000}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\u{10FFFF}\",\"u\"]": {
  "string": "/\\u{10FFFF}/u",
  "flags": "u"
 },
 "[\"\\\\q\",\"\"]": {
  "string": "/\\q/",
  "flags": ""
 },
 "[\"\\\\q\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\q{a}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\q{a}\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[\\\\q{a}]\",\"v\"]": {
  "string": "/[\\q{a}]/v",
  "flags": "v"
 },
 "[\"[\\\\q{a}]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\k\",\"\"]": {
  "string": "/\\k/",
  "flags": ""
 },
 "[\"\\\\k\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\8\",\"\"]": {
  "string": "/\\8/",
  "flags": ""
 },
 "[\"\\\\8\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\9\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"(a)\\\\1\",\"u\"]": {
  "string": "/(a)\\1/u",
  "flags": "u"
 },
 "[\"(a)\\\\2\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\1(a)\",\"\"]": {
  "string": "/\\1(a)/",
  "flags": ""
 },
 "[\"\\\\-\",\"\"]": {
  "string": "/\\-/",
  "flags": ""
 },
 "[\"\\\\-\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\/\",\"u\"]": {
  "string": "/\\//u",
  "flags": "u"
 },
 "[\"\\\\;\",\"\"]": {
  "string": "/\\;/",
  "flags": ""
 },
 "[\"\\\\;\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\a\",\"\"]": {
  "string": "/\\a/",
  "flags": ""
 },
 "[\"\\\\a\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\e\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"[a\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"[]\",\"\"]": {
  "string": "/[]/",
  "flags": ""
 },
 "[\"[^]\",\"\"]": {
  "string": "/[^]/",
  "flags": ""
 },
 "[\"[a-]\",\"\"]": {
  "string": "/[a-]/",
  "flags": ""
 },
 "[\"[a-]\",\"u\"]": {
  "string": "/[a-]/u",
  "flags": "u"
 },
 "[\"[-a]\",\"\"]": {
  "string": "/[-a]/",
  "flags": ""
 },
 "[\"[z-a]\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"[z-a]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[\\\\d-a]\",\"\"]": {
  "string": "/[\\d-a]/",
  "flags": ""
 },
 "[\"[\\\\d-a]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[a-\\\\d]\",\"\"]": {
  "string": "/[a-\\d]/",
  "flags": ""
 },
 "[\"[a-\\\\d]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[\\\\w-\\\\s]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[[]\",\"\"]": {
  "string": "/[[]/",
  "flags": ""
 },
 "[\"[[]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[[]]\",\"v\"]": {
  "string": "/[[]]/v",
  "flags": "v"
 },
 "[\"[a[b]]\",\"v\"]": {
  "string": "/[a[b]]/v",
  "flags": "v"
 },
 "[\"[a[b]]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[a--b]\",\"v\"]": {
  "string": "/[a--b]/v",
  "flags": "v"
 },
 "[\"[a--b]\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[a&&b]\",\"v\"]": {
  "string": "/[a&&b]/v",
  "flags": "v"
 },
 "[\"[--a]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[a&&]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[&&a]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[a---b]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[[a]&&[b]--[c]]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[^[a]&&[b]]\",\"v\"]": {
  "string": "/[^[a]&&[b]]/v",
  "flags": "v"
 },
 "[\"[^\\\\q{}]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[^\\\\q{ab}]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[^\\\\q{a}]\",\"v\"]": {
  "string": "/[^\\q{a}]/v",
  "flags": "v"
 },
 "[\"[^\\\\q{a|bc}]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[^[\\\\q{ab}]]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[^\\\\p{Basic_Emoji}]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\P{Basic_Emoji}\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\p{Basic_Emoji}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"[\\\\p{Basic_Emoji}--\\\\q{a}]\",\"v\"]": {
  "string": "/[\\p{Basic_Emoji}--\\q{a}]/v",
  "flags": "v"
 },
 "[\"[(]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[)]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[|]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[{]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[}]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[(]\",\"u\"]": {
  "string": "/[(]/u",
  "flags": "u"
 },
 "[\"[!!]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"[##]\",\"v\"]": {
  "error": "SyntaxError"
 },
 "[\"^*\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"^*\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"$+\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\b+\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\b+\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"\\\\B{2}\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"(?!)*\",\"u\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"gg\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"uv\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"q\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"d\"]": {
  "string": "/a/d",
  "flags": "d"
 },
 "[\"a\",\"dd\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"l\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"gimsuydv\"]": {
  "error": "SyntaxError"
 },
 "[\"a\",\"givms\"]": {
  "string": "/a/gimsv",
  "flags": "gimsv"
 },
 "[\"(?i:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?-i:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?i-i:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?ii:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?g:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?i)a\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?im-s:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?i:(?-i:a))\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?u:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(?-y:a)\",\"\"]": {
  "error": "SyntaxError"
 },
 "[\"(a|)*\",\"\"]": {
  "string": "/(a|)*/",
  "flags": ""
 },
 "[\"(?:(?:(?:(?:(?:(?:(?:(?:x))))))))*\",\"\"]": {
  "string": "/(?:(?:(?:(?:(?:(?:(?:(?:x))))))))*/",
  "flags": ""
 },
 "[\"(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)\",\"\"]": {
  "string": "/(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)/",
  "flags": ""
 }
};
