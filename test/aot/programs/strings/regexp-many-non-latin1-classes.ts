// Dozens of classes that reach beyond Latin-1 and have much in common, each asked about code points all over the range, surrogates included.
export { };
function hash(h: number, n: number): number { return (Math.imul(h, 31) + n) | 0; }
const classes: RegExp[] = [/[\p{L}]/u, /[^\p{L}]/u, /[\p{L}]+/v, /[\p{L}\p{N}_]/u, /[^\p{L}\p{N}_]/u, /[\p{L}\p{N}_]+/v, /[\p{L}\p{M}\p{N}\p{Pc}]/u, /[^\p{L}\p{M}\p{N}\p{Pc}]/u, /[\p{L}\p{M}\p{N}\p{Pc}]+/v, /[\p{ID_Start}]/u, /[^\p{ID_Start}]/u, /[\p{ID_Start}]+/v, /[\p{ID_Continue}]/u, /[^\p{ID_Continue}]/u, /[\p{ID_Continue}]+/v, /[\p{Alphabetic}]/u, /[^\p{Alphabetic}]/u, /[\p{Alphabetic}]+/v, /[\p{Lu}]/u, /[^\p{Lu}]/u, /[\p{Lu}]+/v, /[\p{Ll}]/u, /[^\p{Ll}]/u, /[\p{Ll}]+/v, /[\p{L}$]/u, /[^\p{L}$]/u, /[\p{L}$]+/v, /[\p{L}\-]/u, /[^\p{L}\-]/u, /[\p{L}\-]+/v, /[\p{L}\p{N}_$]/u, /[^\p{L}\p{N}_$]/u, /[\p{L}\p{N}_$]+/v, /[\p{L}\p{N}_.\-]/u, /[^\p{L}\p{N}_.\-]/u, /[\p{L}\p{N}_.\-]+/v, /[\p{ID_Start}$_]/u, /[^\p{ID_Start}$_]/u, /[\p{ID_Start}$_]+/v, /[\p{ID_Continue}$\u200c\u200d]/u, /[^\p{ID_Continue}$\u200c\u200d]/u, /[\p{ID_Continue}$\u200c\u200d]+/v, /[\p{P}]/u, /[^\p{P}]/u, /[\p{P}]+/v, /[\p{S}]/u, /[^\p{S}]/u, /[\p{S}]+/v, /[\p{P}\p{S}]/u, /[^\p{P}\p{S}]/u, /[\p{P}\p{S}]+/v, /[\p{N}]/u, /[^\p{N}]/u, /[\p{N}]+/v, /[\p{M}]/u, /[^\p{M}]/u, /[\p{M}]+/v, /[\p{Script=Han}]/u, /[^\p{Script=Han}]/u, /[\p{Script=Han}]+/v, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/v, /[\p{Script=Greek}\p{Script=Cyrillic}]/u, /[^\p{Script=Greek}\p{Script=Cyrillic}]/u, /[\p{Script=Greek}\p{Script=Cyrillic}]+/v, /[\p{Emoji}]/u, /[^\p{Emoji}]/u, /[\p{Emoji}]+/v, /[\p{L}\p{Emoji}]/u, /[^\p{L}\p{Emoji}]/u, /[\p{L}\p{Emoji}]+/v, /[\p{Zs}\t]/u, /[^\p{Zs}\t]/u, /[\p{Zs}\t]+/v, /[\p{Lo}]/u, /[^\p{Lo}]/u, /[\p{Lo}]+/v, /[\p{Lo}\p{Lm}]/u, /[^\p{Lo}\p{Lm}]/u, /[\p{Lo}\p{Lm}]+/v, /[\p{Nd}\p{Nl}]/u, /[^\p{Nd}\p{Nl}]/u, /[\p{Nd}\p{Nl}]+/v, /[\u0100-\u017f\u0391-\u03c9\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]/, /[\u0100-\u017f\u0391-\u03c9\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]/, /[\u0100-\u0110\u0120-\u0130\u0140-\u0150\u0160-\u0170\u0180-\u0190\u01a0-\u01b0\u01c0-\u01d0\u9000-\ud7ff]/, /[^\u0100-\u017f\u0391-\u03c9\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]/, /[^\u0100-\u017f\u0391-\u03c9\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]/, /[^\u0100-\u0110\u0120-\u0130\u0140-\u0150\u0160-\u0170\u0180-\u0190\u01a0-\u01b0\u01c0-\u01d0\u9000-\ud7ff]/, /[\u0100-\u017f\u0391-\u03c9\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]/u, /[\u0100-\u017f\u0391-\u03c9\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]/u, /[\u0100-\u0110\u0120-\u0130\u0140-\u0150\u0160-\u0170\u0180-\u0190\u01a0-\u01b0\u01c0-\u01d0\u9000-\ud7ff]/u, /[^\S\n]/u, /[\S\n]/u, /[\W_]/u, /[^\W\d]/u, /[\S]/, /[\W_]/];
const points: number[] = [];
for (let c = 0; c < 0x3000; c += 3) points.push(c);
for (let c = 0x3000; c < 0x11000; c += 37) points.push(c);
for (let c = 0x11000; c < 0x110000; c += 1013) points.push(c);
for (const c of [0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffd, 0xffff, 0x10000, 0x1d400, 0x1f600, 0x2fa1d, 0x323af, 0xe01ef, 0x10ffff]) points.push(c);
for (const r of classes) {
    let alone = 0, inside = 0, count = 0;
    for (const c of points) {
        const s = String.fromCodePoint(c);
        const found = r.test(s);
        if (found) ++count;
        alone = hash(alone, found ? c : -c);
        const m = ("\u2028" + s + "\u2028").match(r);
        inside = hash(inside, m === null ? -1 : (m.index ?? 0) * 8 + m[0].length);
    }
    console.log(r.source.length, r.flags, count, alone, inside);
}
