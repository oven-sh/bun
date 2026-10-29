// A RegExp source built at run time has the same length and hash as a long pattern that is known at build time, but different characters.
declare const console: { log(...args: unknown[]): void }
function text(): string { return "k" + "00000" + "0|[" + "a".repeat(2100) + "aaaaa" + "a".repeat(2095) + "]{9}~~" + "00000" }
function known(flags: string): RegExp { return flags === "iu" ? new RegExp(text(), "iu") : flags === "g" ? new RegExp(text(), "g") : new RegExp(text(), "") }
function atRunTime(head: string, inRun: string, tail: string, flags: string): RegExp { return new RegExp("k" + head + Math.floor(Math.random()) + "|[" + "a".repeat(2100) + inRun + "a".repeat(2095) + "]{9}~~" + tail, flags) }
const others: [string, string, string][] = [["1c7u6", "aaaaa", "00000"], ["2jmqr", "aaaaa", "00000"], ["00000", "121nk", "00000"], ["00000", "thwdq", "00000"], ["00000", "aaaaa", "274wb"], ["00000", "aaaaa", "ivvif"], ["00001", "aaaaa", "00000"], ["00000", "aaaab", "00000"], ["00000", "aaaaa", "00001"]]
const subjects: string[] = ["", "k000000", "k1c7u60", "k2jmqr0", "k000010", "K000000", "K1C7U60", "aaaaaaaaa~~00000", "aaaaaaaaa~~274wb", "aaaaaaaaa~~ivvif", "aaaaaaaaa~~00001", "111111111~~00000", "121nk121n~~00000", "ttttttttt~~00000", "thwdqthwd~~00000", "bbbbbbbbb~~00000", "AAAAAAAAA~~00000", "TTTTTTTTT~~00000", "xk000000 k1c7u60 aaaaaaaaa~~274wb"]
function show(m: RegExpExecArray | null): string { return m === null ? "-" : m.index + ":" + m[0] }
function sum(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
function line(name: string, r: RegExp): void {
  let out = name + " /" + r.flags
  for (const s of subjects) { r.lastIndex = 0; out += " " + show(r.exec(s)) + (r.test(s) ? "t" : "f"); r.lastIndex = 0; out += s.replace(r, "<>").length }
  console.log(out + " " + r.source.length + " " + sum(r.source) + " " + sum(String(r)))
}
for (const flags of ["", "iu", "g"]) {
  for (let i = 0; i < others.length; i++) line("ahead " + i, atRunTime(others[i][0], others[i][1], others[i][2], flags))
  line("known", known(flags))
  line("the same at run time", atRunTime("00000", "aaaaa", "00000", flags))
  for (let i = 0; i < others.length; i++) line("behind " + i, atRunTime(others[i][0], others[i][1], others[i][2], flags))
  line("known again", known(flags))
}
