// Expressions whose match can only begin at one or two particular characters, searched for in subjects long enough for a search sixteen characters at a time: the character at every position of
// subjects of many lengths, with characters that differ from it in one bit around it.
export { };
function hash(h: number, n: number): number { return (Math.imul(h, 31) + n) | 0; }
const fillers: string[] = ["a", "y", "X", "\xf8", "i", "\x69", "\x79", "\x78\x78", " "];
const needles: string[] = ["x", "q", "xy", "X", "\xe9", "\xe9t", "\xff", "\x00", "\x7f", "ax", "</x>", "\"", "\n", "\r\n", "5", "xx", "x" + "\n" + "y"];
function run(r: RegExp): void {
    let h = 0, found = 0;
    for (const length of [0, 1, 2, 14, 15, 16, 17, 18, 30, 31, 32, 33, 34, 47, 48, 49, 63, 64, 65, 80]) {
        for (const filler of fillers) {
            const plain = filler.repeat(length).slice(0, length);
            for (const needle of needles) {
                for (let at = 0; at <= length; at += length > 34 ? 3 : 1) {
                    for (const tail of ["", "\u4e2d"]) {
                        const subject = plain.slice(0, at) + needle + plain.slice(at) + tail;
                        r.lastIndex = 0;
                        const m = subject.match(r);
                        if (m === null) { h = hash(h, -1); continue; }
                        ++found;
                        h = hash(h, m.index === undefined ? m.length : m.index * 4 + m[0].length);
                    }
                }
            }
        }
    }
    console.log(String(r), found, h);
}
run(/x/);
run(/x/g);
run(/xy/);
run(/x/i);
run(/xy/gi);
run(/[xq]/g);
run(/[xq]y/);
run(/x|q/g);
run(/x+y/);
run(/x(?=y)/g);
run(/(x)(y)?/);
run(/x$/);
run(/x\b/g);
run(/\xe9/g);
run(/\xe9t/);
run(/[\xe9i]/g);
run(/\xff/g);
run(/\x00/g);
run(/\x7f|\xff/g);
run(/x.y/s);
run(/.x/g);
run(/..x/);
run(/ax/g);
run(/[a-c]x/g);
run(/x{2}/g);
run(/x*?y/);
run(/<\/?x>/g);
run(/"/g);
run(/\n/g);
run(/\r?\n/g);
run(/x/y);
run(/x/u);
run(/[xq]/giu);
run(/[xqz]/g);
run(/\d/g);
