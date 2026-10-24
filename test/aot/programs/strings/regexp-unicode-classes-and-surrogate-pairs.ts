// Regular expressions with the u or v flag whose classes reach beyond Latin-1, matched against ASCII, Latin-1, other BMP characters on both sides of the surrogates, surrogate pairs and lone surrogates.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const subjects: string[] = [
    "", "a", "Z9_", "x y", "\xe9t\xe9", "\xff", "\u0100b", "\u03a9\u03c9", "\u4e2d\u6587x", "\ud7ff", "\ue000", "\uff41\uff21", "\uffff",
    "\ud835\udc00", "a\ud835\udc00b", "\ud835\udc00\ud835\udc01", "\ud83d\ude00", "x\ud83d\ude00y", "\udbff\udfff", "\ud835", "\udc00", "\ud835a", "a\udc00", "\udc00\ud835", "\ud835\ud835\udc00", "\ud835\udc00\udc00",
    "name(", "\u540d\u524d(", "\ud835\udc00_1(", "if x", "Hello World", "\u0391\u03b2\u03b3 \u0394", "abcdef\u03a9", "abcdef\ud835\udc00", "abcdef\ud83d\ude00", "a1_:", "\u4e2d1_:", "\ud835\udc00:",
    "axb", "\u4e2dx\ud835\udc00", "\ud835\udc00x\u03a9", "\ud83d\ude00xa", "xay", "x\u4e2dy", "x\ud835\udc00y", "xy", "x\ud835y", "a\u03a9b", "a\ud835\udc00\ud835\udc01b", "7 ", "7\ud83d\ude00", "a7", "\ud835\udc007", "\u00e9t", "_1(", "abcdef ", "\u4e2dx",
];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const subject of subjects) {
        for (const at of r.sticky || r.global ? [0, 1, 2] : [0]) {
            r.lastIndex = at;
            const m = subject.match(r.global ? new RegExp(r.source, r.flags.replace("g", "y")) : r);
            r.lastIndex = at;
            parts.push((m === null ? "-" : m.index + ":" + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + escape(c) + ">").join("")) + (r.test(subject) ? "+" + r.lastIndex : ""));
        }
    }
    console.log(String(r), parts.join(" "));
}
show(/\p{L}/u);
show(/\p{L}+/u);
show(/\p{L}*$/u);
show(/^\p{L}+$/u);
show(/\p{L}x\p{L}/u);
show(/\p{L}{2}/u);
show(/\p{L}{2,3}?./u);
show(/\p{L}+?\P{L}/u);
show(/\P{L}/u);
show(/\P{L}+/u);
show(/^\P{L}*$/u);
show(/[^\p{L}]/u);
show(/[^\p{L}\p{N}_]+/u);
show(/[\p{L}\p{N}_]+:/u);
show(/[\p{L}\p{N}_]+:/v);
show(/[\p{L}\p{N}_]+:/iu);
show(/[\p{L}\p{M}\p{N}\p{Pc}]+/gv);
show(/[\p{L}\p{M}\p{N}\p{Pc}]+/yv);
show(/\p{Lu}\p{Ll}+/gu);
show(/\p{Lu}\p{Ll}*/giu);
show(/(?=([\p{L}_][\p{L}\p{N}_]*))\1\(/v);
show(/(?=(\p{L}+))\1(?!\p{N})/u);
show(/(\p{L})(\p{L})?/u);
show(/(?:\p{L}|\p{N})+/u);
show(/(?:\p{Lu}|\p{Ll}\p{Ll})*$/u);
show(/(?<=\p{L})\p{N}/u);
show(/(?<!\p{L})\p{L}/gu);
show(/\p{L}\b/u);
show(/\b\p{L}+\b/giu);
show(/abcdef\p{L}/u);
show(/abcdef\P{L}/u);
show(/x\p{L}?y/u);
show(/x[^\p{L}]?y/u);
show(/\p{ID_Start}\p{ID_Continue}*/gu);
show(/\p{Emoji}/u);
show(/\p{Script=Han}+/u);
show(/\p{Script=Greek}+/gu);
show(/[\p{L}\u{1F600}-\u{1F64F}]+/u);
show(/[^\p{Lu}\u{10000}-\u{10FFFF}]+/u);
show(/[\p{Ll}\u{E000}-\u{10FFFF}]+/u);
show(/[\p{L}\ud800-\udbff]+/u);
show(/[^\p{L}\udc00-\udfff]+/u);
show(/[\u0100-\u017f\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]+/u);
show(/[^\u0100-\u017f\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]+/u);
show(/[a-z\u0100-\u017f\u0391-\u03a9\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef\u{1D400}-\u{1D7FF}]+/u);
show(/[^a-z\u0100-\u017f\u0391-\u03a9\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef\u{1D400}-\u{1D7FF}]+/u);
show(/[a-z]+/u);
show(/[a-z\xe9]+\P{L}/u);
show(/[^a-z]+/u);
show(/\w+\s\w+/u);
show(/\d\W/u);
show(/a/u);
show(/\xe9t/u);
show(/\u4e2d\u6587?x/u);
show(/\uffff|\ue000|\ud7ff/u);
show(/\u{1D400}/u);
show(/\u{1D400}+b?/u);
show(/\ud835/u);
show(/\udc00/u);
show(/\ud835\udc00/u);
show(/a\p{L}b/u);
show(/_\d\(/u);
show(/./gu);
show(/.\p{L}/su);
console.log(escape("a\ud835\udc00b \u4e2d\u6587 x1".replace(/\p{L}+/gu, "[$&]")), escape("a\ud83d\ude00b\ud83dc".split(/\P{L}/u).join("|")), [..."ab \u03a9\u03c9 \ud835\udc00\ud835\udc01".matchAll(/\p{L}/gu)].length);
