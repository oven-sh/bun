// Runs of eight and more literal characters, matched against 16-bit subjects in which one character at a time is replaced by look-alikes beyond Latin-1.
export { };
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const texts: string[] = ["abcdefghijklmnopqrstuvwxyz0123456789", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "aBcDeFgHiJkLmN", "abc1efg-ijklmn", "xabcdefghx", "abcdefghhh", "abcdefghabcdefgh", "abcdefghik", "abcdefghjk", "ijklmnop", "abcdfghij", "abcefghij", "bbcdefghi", "abcdefghj",
    "abcdfgijklmn", "abc5efghijk", "ab-defghijk", "abcdefghijkl", "acdbefghijkl", "abcdefg\xe9", "\xe9bcdefgh", "abc\xe9efghijk", "abc\xc9efghijk", "abcdefg\xff", "abc\xffefghijk", "abcdefg\x00", "abc\x00efghijk", "abcdefg\xfe", "abcdefg\x01",
    "abcdefg\u0100", "abc\u0161efghijk", "abcdefg\u4e2d", "abcdefgh\u03a9", "\u03a9abcdefgh", "abcdefgh\ud83d\ude00", "\ud83d\ude00abcdefgh", "abcdefghx", "abcdefgh"];
function variants(s: string): string[] {
    const all: string[] = [s, s + "\u0100", "\u0100" + s, "  " + s + "\u4e2d"];
    for (let i = 0; i < s.length; ++i) {
        const c = s.charCodeAt(i);
        for (const other of [c + 0x100, c + 0xff00, c | 0x8000, c | 0x7f00, 0xff, 0, c ^ 0x20, 0xffff])
            all.push(s.slice(0, i) + String.fromCharCode(other & 0xffff) + s.slice(i + 1) + "\u0100");
    }
    return all;
}
function show(r: RegExp): void {
    let hash = 0, matches = 0; const first: string[] = [];
    for (const text of texts) {
        for (const subject of variants(text)) {
            r.lastIndex = 0;
            const m = subject.match(r);
            const shown = m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + escape(m[0]);
            for (let i = 0; i < shown.length; ++i) hash = (Math.imul(hash, 31) + shown.charCodeAt(i)) | 0;
            if (m !== null && ++matches <= 3) first.push(escape(subject) + "=" + shown);
        }
    }
    console.log(String(r), matches, hash, first.join(" "));
}
show(/abcdefgh/);
show(/abcdefghi/);
show(/abcdefghij/);
show(/abcdefghijk/);
show(/abcdefghijkl/);
show(/abcdefghijklm/);
show(/abcdefghijklmn/);
show(/abcdefghijklmno/);
show(/abcdefghijklmnop/);
show(/abcdefghijklmnopq/);
show(/abcdefghijklmnopqrstuvwx/);
show(/abcdefghijklmnopqrstuvwxyz0123456789/);
show(/abcdefgh/i);
show(/aBcDeFgHiJkL/i);
show(/abc1efg-ijkl/i);
show(/ABCDEFGHIJKLMNOPQ/i);
show(/^abcdefgh$/);
show(/^abcdefghijkl$/);
show(/xabcdefgh/);
show(/abcdefghx?/);
show(/abcdefgh+/);
show(/(abcdefgh)+/);
show(/(?:abcdefghi|abcdefghj)k/);
show(/abcdefgh|ijklmnop/);
show(/abc[de]fghij/);
show(/[ab]bcdefghi/);
show(/abcdefgh[ij]/);
show(/abc[de]fg[hi]jklmn/);
show(/abc.efghijk/);
show(/abc\defghijk/);
show(/ab[^c]defghijk/);
show(/abc[de]fghij/i);
show(/a[b-d][b-d][b-d]efghijkl/);
show(/abcdefg\xe9/);
show(/\xe9bcdefgh/);
show(/abc\xe9efghijk/);
show(/abc\xe9efghijk/i);
show(/abcdefg\xff/);
show(/abc\xffefghijk/);
show(/abcdefg\x00/);
show(/abc\x00efghijk/);
show(/abcdefg\xfe/);
show(/abcdefg\x01/);
show(/abcdefg\u0100/);
show(/abc\u0161efghijk/);
show(/abcdefg\u4e2d/);
show(/abcdefgh/u);
show(/abcdefghijkl/u);
show(/abcdefghijkl/iu);
show(/abc[de]fghij/u);
show(/abcdefgh\p{L}/u);
show(/\p{L}abcdefgh/u);
show(/abcdefgh\u{1F600}/u);
show(/\u{1F600}abcdefgh/u);
show(/abcdefgh/v);
show(/abcdefgh/y);
show(/abcdefgh/g);
show(/abcdefgh/m);
show(/(?<=abcdefgh)x/);
show(/(?<!abcdefgh)x/);
show(/(?=abcdefgh)a/);
show(/(?!abcdefgh)a/);
