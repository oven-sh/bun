// \s, \S, \w, \W and \b on every character of the Basic Multilingual Plane, in subjects of 8-bit and of 16-bit characters, alone and side by side in one expression.
export { };
function ranges(members: number[]): string {
    const parts: string[] = [];
    for (let i = 0; i < members.length;) {
        let j = i;
        while (j + 1 < members.length && members[j + 1] === members[j] + 1) ++j;
        parts.push(i === j ? members[i].toString(16) : members[i].toString(16) + "-" + members[j].toString(16));
        i = j + 1;
    }
    return parts.join(" ");
}
function membersOf(r: RegExp, limit: number, suffix: string): number[] {
    const members: number[] = [];
    for (let c = 0; c < limit; ++c) {
        if (r.test(String.fromCharCode(c) + suffix)) members.push(c);
    }
    return members;
}
const alone: RegExp[] = [/^\s/, /^\S/, /^\w/, /^\W/, /^[\s\w]/, /^[^\s\w]/, /^\s+$/, /^\w+$/, /^\w\b/, /^\W\B/, /^\w/i, /^\W/i, /^\s/i, /^[\w-]/, /^[\s,;]/, /^(?:\s|\w)/, /^(?!\s)(?!\w)/];
for (const r of alone) {
    console.log(String(r), "8-bit:", ranges(membersOf(r, 0x100, "")));
    console.log(String(r), "the same characters in a 16-bit subject:", ranges(membersOf(r, 0x100, "\u0100")));
    console.log(String(r), "16-bit:", ranges(membersOf(r, 0x10000, "")).length < 400 ? ranges(membersOf(r, 0x10000, "")) : "not " + ranges(membersOf(new RegExp("^(?!" + r.source.slice(1) + ")", r.flags), 0x10000, "")));
}
const subjects: string[] = [
    "", "a b", " a_1  b-2\t", "\xa0x\xa0", "one two  three", "　中 文﻿", "a b c", "   ​  ", "kKſs", "x中_9 中", "tab\thereé été",
];
const together: RegExp[] = [/\s+/g, /\S+/g, /\w+/g, /\W+/g, /\w+\s+\w+/, /\s\w|\w\s/g, /(\w+)(\s*)(\W*)/g, /\b\w/g, /\B\S/g, /^\s*(\S.*\S|\S?)\s*$/, /[\w\s]+/g, /[^\w\s]+/g, /\s*,\s*|\s+/g, /\w+/gi, /\W+/gi];
for (const r of together)
    console.log(String(r), subjects.map((s: string): string => JSON.stringify(s.match(r))).join(" "));
console.log(subjects.map((s: string): string => JSON.stringify(s.trim().split(/\s+/))).join(" "));
console.log(subjects.map((s: string): string => JSON.stringify(s.replace(/\w/g, "w").replace(/\s/g, "_"))).join(" "));
