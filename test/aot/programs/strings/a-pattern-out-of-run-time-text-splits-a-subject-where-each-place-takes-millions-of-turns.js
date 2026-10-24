// split() asks the pattern at every place of the subject. At some of them the answer comes only behind tens of millions of turns of the groups.
const nothing = String(Date.now()).slice(99);
const text = "\\udbff{0}[^\\ud83d\\ude00]|(?<n1>(?!\\ud83d\\ude00??\\b)()*|\\2*)?(?:.[^\\ud83d\\ude00]{1,3}?(?:[\\ud83d\\ude00-\\ud83d\\ude4f]{2,4}){0,3}|\\udfff{0})*\\w?\\udfff";
const subject =
  "\ud800퟿𝟿a\ud83d\ud800\ud835퟿\udc00😀a￿￿\udc00￿\udc00Ā￿\ud800a퟿🟿\ud83d🐀aĀ\ud835\udbff\ude00\ud835aa\ud835퟿\udc00\ude00aĀa\udc00😀Ā\ud83da\ud835퟿퟿\ud800￿￿a\ude00\ude00";
console.log(subject.split(new RegExp(text + nothing, "v")).length);
