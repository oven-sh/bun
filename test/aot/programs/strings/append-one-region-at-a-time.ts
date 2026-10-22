// A string buffer region is never begun inside another, and an attempt that is rejected leaves no mark on the regions that stay.
// IR= 1 abandons  = StringBuilderBegin
// IR= 0 builds  = StringBuilderBegin
// IR= 0 builds  = Integer integer=257\b
function loose(value: unknown): any { return value; }
function check(i: number): string { if (i === 2) throw new Error("stop"); return "ok"; }
function abandons(s: string, n: number): string {
  let r = "<w>";
  for (let i = 0; i < 3; i++) r += `${i}-${n}:${check(i)}:${s}`;
  return r + "</w>";
}
function builds(s: string, n: number): string {
  let r = "";
  for (let i = 0; i < 2; i++) {
    const t = ` ${n * 3}"${loose("t")} ${1}日${n}.`;
    for (let j = 0; j < (n & 1); j++) {
      r += `-${n + 1}"${loose(t)}.`;
      if (s.length === 0) return "</b>";
    }
    r += s.length + 255;
  }
  return `<x>${r}</x>`;
}
function run(which: number, s: string, n: number): string {
  const result = which === 0 ? abandons(s, n) : builds(s, n);
  return result + "!";
}
const kept = [abandons, builds, run];
for (let round = 0; round < 2; round++) {
  for (const which of [0, 1, 0, 1]) {
    for (let n = -1; n < 3; n++) {
      try {
        console.log(which, n, JSON.stringify((kept[2] as any)(which, "ab", n)));
      } catch (error) {
        console.log(which, n, "threw", (error as Error).message);
      }
    }
  }
}
