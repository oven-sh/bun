// Classes beyond Latin-1 under the u and v flags where the subject ends: at the last character, in the middle of what the expression still needs, and at a surrogate pair or half of one.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const subjects: string[] = ["", "a", "ab", "abc", "1", "a1", "1a", "a ", " a", "\u03a9", "a\u03a9", "\u03a9a", "\u4e2d\u6587", "\ud835\udc00", "a\ud835\udc00", "\ud835\udc00a", "\ud835\udc00\ud835\udc00", "\ud83d\ude00", "a\ud83d\ude00", "\ud83d\ude00a", "\ud835", "a\ud835", "\udc00", "a\udc00", "\ud835\udc00\ud835", "\ud835\ud835\udc00", "ab\u0100", "\u0100", "1\u0100", "\u0661", "a\u0661"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const subject of subjects) {
        for (let at = 0; at <= (r.sticky || r.global ? subject.length : 0); ++at) {
            r.lastIndex = at;
            const found = r.test(subject);
            const end = r.lastIndex;
            r.lastIndex = at;
            const m = r.global ? null : subject.match(r);
            parts.push((found ? "+" + end : "-") + (m === null ? "" : m.index + ":" + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + escape(c) + ">").join("")));
        }
    }
    console.log(String(r), parts.join(" "));
}
show(/\p{L}/u);
show(/a\p{L}/u);
show(/\p{L}\p{L}/u);
show(/\p{L}\p{L}\p{L}/u);
show(/\p{L}+/u);
show(/\p{L}+$/u);
show(/\p{L}*$/u);
show(/^\p{L}*$/u);
show(/\p{L}*?\p{N}/u);
show(/\p{L}+?\p{N}?$/u);
show(/\p{L}{2}/u);
show(/\p{L}{2,3}/u);
show(/\p{L}?\p{L}/u);
show(/[^\p{L}]/u);
show(/a[^\p{L}]/u);
show(/[^\p{L}][^\p{L}]/u);
show(/[^\p{L}]+$/u);
show(/[^\p{L}]*?a/u);
show(/(?:\p{L}|\p{N})+/u);
show(/(\p{L})(\p{L})?/u);
show(/(?=\p{L})./u);
show(/(?!\p{L})./su);
show(/\p{L}/yu);
show(/\p{L}+/yu);
show(/[^\p{L}]/yu);
show(/\p{L}\p{N}/gu);
show(/\p{L}/v);
show(/\p{L}+[^\p{L}]/v);
show(/\p{L}(?:\p{L}|$)/u);
show(/\p{L}\b/u);
