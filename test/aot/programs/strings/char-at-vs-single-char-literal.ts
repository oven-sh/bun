// `<`, `<=`, `>` and `>=` between a character read from a string and a one-character literal.
declare const console: any;

const texts: string[] = ["", " ", "a", "az", "~\x7f\0", "\x80\xe9\xff", "Ā ￿", "😀", "aĀa"];

function byIndex(text: string, i: number): string {
    const c = text[i];
    return `${c < " "}${c <= " "}${c > " "}${c >= " "}|${c < "a"}${c <= "a"}${c > "a"}${c >= "a"}|${c < "~"}${c <= "~"}${c > "~"}${c >= "~"}|${c < "\0"}${c <= "\0"}${c > "\0"}${c >= "\0"}|${c < "\x7f"}${c <= "\x7f"}${c > "\x7f"}${c >= "\x7f"}`;
}

function byIndexWithTheLiteralFirst(text: string, i: number): string {
    const c = text[i];
    return `${" " < c}${" " <= c}${" " > c}${" " >= c}|${"a" < c}${"a" <= c}${"a" > c}${"a" >= c}|${"~" < c}${"~" <= c}${"~" > c}${"~" >= c}|${"\0" < c}${"\0" <= c}${"\0" > c}${"\0" >= c}`;
}

function byCharAt(text: string, i: number): string {
    const c = text.charAt(i);
    return `${c < " "}${c <= " "}${c > " "}${c >= " "}|${c < "a"}${c <= "a"}${c > "a"}${c >= "a"}|${"a" < c}${"a" <= c}${"a" > c}${"a" >= c}|${c < "\0"}${c <= "\0"}${c > "\0"}${c >= "\0"}`;
}

function byAt(text: string, i: number): string {
    const c = text.at(i);
    if (c === undefined) return "nothing there";
    return `${c < " "}${c <= " "}${c > " "}${c >= " "}|${c < "a"}${c <= "a"}${c > "a"}${c >= "a"}|${"a" < c}${"a" <= c}${"a" > c}${"a" >= c}`;
}

function byAtThatMayBeUndefined(text: string, i: number): string {
    const c = text.at(i) as string;
    return `${c < "a"}${c <= "a"}${c > "a"}${c >= "a"}|${"a" < c}${"a" <= c}${"a" > c}${"a" >= c}`;
}

function countOfControlCharacters(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] < " ") count++;
    }
    return count;
}

function lengthOfNumber(text: string): number {
    let i = 0;
    while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
    return i;
}

function pastTheEnd(text: string): number {
    let count = 0;
    for (let i = 0; i <= text.length + 1; i++) {
        if (text[i] < "z") count += 1;
        if (text[i] >= "\0") count += 10;
        if (text.charAt(i) < "z") count += 100;
        if (text.charAt(i) >= "\0") count += 1000;
    }
    return count;
}

for (const text of texts) {
    for (let i = -2; i <= text.length + 1; i++)
        console.log(JSON.stringify(text), i, byIndex(text, i), byIndexWithTheLiteralFirst(text, i), byCharAt(text, i), byAt(text, i), byAtThatMayBeUndefined(text, i));
    console.log(JSON.stringify(text), countOfControlCharacters(text), lengthOfNumber(text), pastTheEnd(text));
}
console.log(countOfControlCharacters("a\tb\nc\0d\x1fe f"), lengthOfNumber("12345x"), lengthOfNumber("/0:"), lengthOfNumber("0123456789"), pastTheEnd("hello, world"));
console.log(byIndex("abc", 1.5), byIndex("abc", NaN), byCharAt("abc", 1.5), byCharAt("abc", NaN), byCharAt("abc", -0), byAt("abc", -1), byAt("abc", 1.9));
export {};
