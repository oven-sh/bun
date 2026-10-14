// Substring operations in code outside loops.
function truth(s: string): string { return s ? "yes:" + s : "no" }
function ofRope(a: string, b: string): string {
    const r = a + b
    return [truth(r.slice(2, 2)), truth((a + b).slice(2, 3)), truth((a + b).slice(3, 2)), truth((a + b).slice(0)), truth((a + b).slice(-3)), truth((a + b).slice(1, -1)), truth((a + b).substring(5, 2)), truth((a + b).substr(2, 4)), truth((a + b).substr(2, 0)), truth((a + b).slice(100)), truth((a + b).slice(0, 1))].join("|")
}
function ofFlat(s: string): string {
    return [truth(s.slice(2, 2)), truth(s.slice(2, 3)), truth(s.slice(3, 2)), truth(s.slice(0)), truth(s.slice(-3)), truth(s.slice(1, -1)), truth(s.substring(5, 2)), truth(s.substr(2, 4)), truth(s.substr(2, 0)), truth(s.slice(100)), truth(s.slice(0, 1)), truth(s.slice(0, s.length))].join("|")
}
function ofPart(s: string): string {
    const p = s.slice(2, 12)
    const q = p.slice(1, 8)
    return [truth(p), truth(q), truth(q.slice(2, 2)), truth(q.slice(2, 3)), truth(q.slice(3, 2)), truth(q.slice(0)), truth(q.substring(4, 1)), truth(q.substr(1, 3)), truth(q.slice(0, 7) === q ? "the whole" : "another")].join("|")
}
console.log(ofRope("abcdef", "ghijkl"))
console.log(ofRope("ab", "c"))
console.log(ofRope("ЖЗИ", "abc→def"))
console.log(ofRope("éè", "üöäxyz"))
console.log(ofFlat("abcdefghijkl"))
console.log(ofFlat("ab"))
console.log(ofFlat(""))
console.log(ofFlat("ЖЗИabc→def"))
console.log(ofPart("0123456789abcdefghij"))
console.log(ofPart("Ж123456789abcdefghij"))
console.log(ofPart("0123"))
