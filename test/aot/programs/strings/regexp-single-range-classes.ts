// Character classes that are a single range, at both ends of the range and just outside it, in both string widths.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const subjects: string[] = ["", "a", "z", "`", "{", "m5", "5m", "/", ":", "0", "9", "abc", "ab1", "12-34", "12-3x", "Hello World", "ABC", "a`z{", "@[", "ab", "a a", "~ !", "\x00", "\x1f ", "\x7f\x80\xff", "\u4dff\u4e00\u9fff\ua000", "\u00ff\u0100", "\u03b0\u03b1a", "\u03c9z\u03ca", "\ud7ff\ud800", "\udfff\ue000", "\ud800\udc00", "a\u0161", "\u01305", "\uff411"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const s of subjects) {
        for (const subject of [s, s + "\u2028"]) {
            r.lastIndex = 0;
            const m = subject.match(r);
            parts.push(m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + escape(c) + ">").join(""));
        }
    }
    console.log(String(r), parts.join(" "));
}
show(/[a-z]/);
show(/[a-z]+/);
show(/^[a-z]*$/);
show(/[a-z]{3}/);
show(/[a-z]+?[0-9]/);
show(/\d/);
show(/\d+/g);
show(/^\d{2}-\d{2}$/);
show(/[0-9][a-z]/);
show(/[a-z][0-9]/);
show(/([a-z])([0-9])?/);
show(/[A-Z][a-z]*/g);
show(/[\x00-\x1f]/);
show(/[\x80-\xff]+/);
show(/[!-~]+/);
show(/[a-a]b/);
show(/(?:[a-z]|[0-9])+/);
show(/[a-z](?=[0-9])/);
show(/(?<=[a-z])[0-9]/);
show(/[a-z]\b/);
show(/[a-z]/i);
show(/[a-z]+/y);
show(/[a-z]+/u);
show(/\d+/u);
show(/[\u4e00-\u9fff]+/);
show(/[\u0100-\uffff]/);
show(/[\u03b1-\u03c9][a-z]/);
show(/[\ud800-\udfff]/);
show(/[\u4e00-\u9fff]+/u);
show(/[\u{10000}-\u{10ffff}]/u);
