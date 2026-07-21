const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
// 6049 signature: gimsv, exec on "😀😀"
{ const re = new RegExp("[.z\\d][^\\dyx-zx]{0}?|(|[éy0-9]((?:\\1)?3{0,2}x|(?<!.+(?:\\1){0}?))?||^\\s{2,}?$){0}?(?!5{0}[y]{2,}|. {0,2}?)", "gimsv");
  const m = re.exec("😀😀"); out("6049 exec: index=" + (m && m.index) + " lastIndex=" + re.lastIndex); }
// 6022 signature: split on ".\n"
{ const re = new RegExp("(?<!\\p{ASCII_Hex_Digit}*(?=\\b)(?:\\w?.{1,3}(x\\da)??))\\s{0,2}(?:\\1)", "v");
  out("6022 split: " + s(".\n".split(re))); }
// 6023 capture: match[1] should be null
{ const re = new RegExp("\\t|(?=^|Ω|\\t[\\s\\w])((?:\\1){2,}?.{2}\\W{0,2}|.(?!d{2,}?)|\\t+(?:\\1)??)", "v");
  out("6023 exec: " + s(re.exec("\n\t\n"))); }
// 6053 capture: match[2] should be null
{ const re = new RegExp(".?(?!(?:\\b)|(?:\\D??.{0,2}\\W){2}?((?:\\1){2,}(?:\\1)||a{2,})\\p{Script=Greek}{0,2})|^(?:.+:+)|(|[\\-_].)(?:\\2)漢", "v");
  out("6053 exec: " + s(re.exec("-b漢"))); }
