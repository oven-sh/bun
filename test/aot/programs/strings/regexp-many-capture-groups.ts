// Regular expressions with a dozen and more capture groups: what is undefined after a match, after backtracking out of a group and after another iteration of a loop.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const narrow: string[] = ["", "abcdefghijk", "abcdefghijkl", "abcdefghijklm", "abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz", "a", "z", "a1b2c3d4e5f6g7h8", "abcxabx", "abc-ab-", "abc-", "ab-c-", "abce", "aabcdebe", "abcabcx", "abcdefghijklx", "abcdefghijkl5", "abc!", "xyz!", "xy!abc!", "abcxq", "ABCDEFGHIJKLM", "abcdefghijklla", "abcdefghijkllb"];
const wide: string[] = ["\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1\u03b1", "abcdef\u4e2d\u4e2d\u4e2d\u4e2d\u4e2d\u4e2d", "\ud835\udc00abcdefghijk", "abcdefghijk\ud835\udc00"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const subject of narrow.concat(narrow.map((s: string): string => s + "\u0100"), wide)) {
        r.lastIndex = 0;
        const m = subject.match(r);
        parts.push(m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + m.map((c: string | undefined): string => c === undefined ? "~" : c === "" ? "0" : escape(c)).join(","));
    }
    console.log(r.source.length, r.flags, parts.join(" "));
}
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/);
show(/([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?/);
show(/^([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?([a-z])?$/);
show(/(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(a)|(z)/);
show(/(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))(?:([a-z])|([0-9]))/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?x)+/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?-)*$/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?-){2}/);
show(/(?:(a)|([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?([b-d])?e)+/);
show(/(([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?)*?x/);
show(/(?=([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z]))\1/);
show(/(?!([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])x)[a-z]/);
show(/(?<=([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z]))[0-9]/);
show(/(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?|([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?([x-z])?)!/);
show(/^(?:([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?([a-c])?x|.)*$/);
show(/(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)/s);
show(/(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)(.)/u);
show(/(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})(\p{L})/u);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/g);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/y);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])/i);
show(/([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])([a-z])\12\1/);
