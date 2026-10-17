// A lookahead that captures under a name, followed by a reference to that name: the way atomic groups and possessive quantifiers are written in JavaScript. Beside it, named references that must really compare.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const subjects: string[] = ["", "xy", "xay", "xaay", "xaaay", "xaaa", "xaab", "xaaby", "xaaaa", "XAAY", "xAay", "xaaY", "xabc", "xabay", "xbaby", "xaayx", "xaayy", "xaaaay", "xayaay", "xaayaa", "xab", "xaabb", "\"abc\"", "'a\"", "\"a'b\"", "  word", "word", " 9", "x\u03b1\u03b2;", "x\u03b1\u03b2\u03b3", "x\ud835\udc00\ud835\udc00y", "x\ud835\udc00y", "x\ud835y", "yz", "ybbz", "xaaz", "aa", "bb", "ab", "aaxaa", "axa", "foo bar", "foo  bar baz", "xaaya", "xaaa\u0100", "zzxaay"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const s of subjects) {
        for (const subject of [s, s + "\u4e2d"]) {
            r.lastIndex = 0;
            const m = subject.match(r);
            parts.push(m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + escape(c) + ">").join(""));
        }
    }
    console.log(String(r), parts.join(" "));
}
show(/x(?=(?<n>a+))\k<n>y/);
show(/x(?:(?=(?<n>a+))\k<n>)y/);
show(/x(?:(?=(?<n>a+))\k<n>)a/);
show(/x(?:(?=(?<n>a*))\k<n>)y/v);
show(/x(?:(?=(?<n>\p{L}+))\k<n>);/v);
show(/x(?:(?=(?<n>\p{L}+))\k<n>)\p{L}/v);
show(/(?:(?=(?<s>\s*))\k<s>)(?:(?=(?<w>\p{L}+))\k<w>)\b/v);
show(/x(?:(?=(?<n>(?:a|b)+))\k<n>)y/v);
show(/x(?:(?=(?<n>(?:a|ab)))\k<n>)c/);
show(/x(?:(?=(?<n>a+))\k<n>)+y/v);
show(/x(?:(?=(?<n>a+))\k<n>)?y/v);
show(/x(?:(?=(?<n>a+))\k<n>)*?y/v);
show(/x(?:(?=(?<n>a+))\k<n>)y/iv);
show(/x(?:(?=(?<n>[a-z]+))\k<n>)Y/i);
show(/x(?:(?=(?<n>\p{Lu}+))\k<n>)y/iu);
show(/(?<q>x)(?:(?=(?<n>a+))\k<n>)y\k<q>/v);
show(/x(?<n>a+)\k<n>y/v);
show(/x(?<n>a+)y\k<n>/);
show(/(?<q>["\x27]).*?\k<q>/);
show(/(?<q>["\x27])(?:(?=(?<n>[^"\x27]*))\k<n>)\k<q>/);
show(/x(?=(?<n>a+))b?\k<n>y/);
show(/x(?=(?<n>a+)b)\k<n>b/);
show(/x(?=(?<n>a+))\k<n>\k<n>/);
show(/x(?!(?<n>a+)b)\k<n>a/);
show(/x(?=(?<n>a+))(?:\k<n>)y/);
show(/x(?=(?<n>a+))\k<n>{2}/);
show(/x(?=(?<n>a+))\k<n>?y/);
show(/\k<n>x(?=(?<n>a+))\k<n>y/);
show(/(?:x(?=(?<n>a+))\k<n>|y(?=(?<n>b+))\k<n>)z/v);
show(/(?:(?<n>a)|(?<n>b))\k<n>/v);
show(/(?<=(?<n>a+))x\k<n>/);
show(/x(?:(?=(?<n>(?<m>a)+))\k<n>)\k<m>/);
show(/x(?:(?=(?<n>\u{1D400}+))\k<n>)y/v);
show(/x(?:(?=(?<n>.+?))\k<n>)y/sv);
show(/^(?:(?=(?<n>\w+))\k<n>)(?:(?=(?<m>\s+))\k<m>)(?:(?=(?<o>\w+))\k<o>)$/v);
show(/x(?:(?=(?<n>a+))\k<n>)y/g);
show(/x(?:(?=(?<n>a+))\k<n>)y/y);
