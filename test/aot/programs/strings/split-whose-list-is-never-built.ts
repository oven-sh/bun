// `text.split(separator)` where only the length or the first pieces are read, with separators of one character and of more, in Latin-1 and UTF-16 strings, ropes and substrings.
const parsed: any = JSON.parse('{"texts":["","a",",","a,b",",a,",",,","a,,b","aXbXc","é,é","ééé","中,文","中文中","😀,😀","a\ud83db","ab,ab,ab","aaaa"],"separators":[",","a","X","é","中","\ud83d","\ude00","ab","aa",",,","","文中","Ā"]}');
function count(text: string, separator: string): number { return text.split(separator).length; }
function first(text: string, separator: string): string | undefined { return text.split(separator)[0]; }
function second(text: string, separator: string): string | undefined { return text.split(separator)[1]; }
function firstThree(text: string, separator: string): string { const [a, b, c] = text.split(separator); return a + "|" + b + "|" + c; }
function whole(text: string, separator: string): string { return JSON.stringify(text.split(separator)); }
const texts: string[] = parsed.texts.slice();
for (const text of parsed.texts as string[]) {
  texts.push(text + "," + text + parsed.texts[3], ("__" + text + "__").slice(2, -2), (text + text + text + text + "0123456789").repeat(2));
}
const lines: string[] = [];
for (let round = 0; round < 40; round++) {
  for (const text of texts) {
    for (const separator of parsed.separators as string[]) {
      const line = count(text, separator) + " " + JSON.stringify([first(text, separator), second(text, separator), firstThree(text, separator)]);
      if (!round) lines.push(line + " " + (JSON.parse(whole(text, separator)).length === count(text, separator)));
    }
  }
}
console.log(lines.join("\n"));
