// Expressions that begin with (or soon reach) a class tested by a table: where the search for the next start finds them, and where it does not.
export { };
function hash(h: number, n: number): number { return (Math.imul(h, 31) + n) | 0; }
function escape(s: string): string {
    let out = "";
    for (let i = 0; i < s.length; ++i) { const c = s.charCodeAt(i); out += c >= 0x20 && c < 0x7f ? s[i] : "\\u" + c.toString(16).padStart(4, "0"); }
    return out;
}
const subjects: string[] = ["", " ", "x", "  x", "foo(bar, baz_1); $q = 42;", "12345", "   ", "a@b c.d-e@f-g", "--- ,x ;x", "aab bcc", "a_b aXb a1b", "\xe9_x \xe0x", "tail $", "0 1 2 a", "\t\n x\r\n"];
function show(r: RegExp): void {
    const parts: string[] = [];
    for (const s of subjects) {
        for (const subject of [s, s + "\u4e2d", "\u4e2d" + s]) {
            r.lastIndex = 0;
            const m = subject.match(r);
            parts.push(m === null ? "-" : (m.index === undefined ? "" : m.index + ":") + m.map((c: string | undefined): string => c === undefined ? "~" : "<" + escape(c) + ">").join(""));
        }
    }
    console.log(String(r), parts.join(" "));
}
show(/[a-zA-Z_$][\w$]*/g);
show(/\s+/g);
show(/[\w.-]+@[\w-]+/g);
show(/[A-Za-z0-9_-]{3}/g);
show(/[ \t,;]x/g);
show(/[^a-zA-Z0-9\s]+/g);
show(/a[a-zA-Z_$]b/g);
show(/[a-zA-Z_$]/);
show(/[a-zA-Z_$]$/);
show(/[a-zA-Z_$](?=\()/g);
show(/([a-zA-Z_$])\1/g);
show(/[a-zA-Z_$]+?;/g);
show(/[a-zA-Z_$]|[0-9]/g);
show(/\b[a-zA-Z_$]/g);
show(/[a-zA-Z_$]/y);
show(/[a-zA-Z_$][0-9]/gi);
show(/[aeiouAEIOU][^aeiouAEIOU\s]/g);
show(/\w\W/g);
show(/\W\w/g);
show(/\s\S/g);
show(/\S\s/g);
show(/[\xa0-\xff_a-z]x/g);
show(/..[a-zA-Z_$]/g);
show(/[a-zA-Z_$]../gs);
