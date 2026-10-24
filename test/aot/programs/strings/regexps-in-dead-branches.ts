// The source of a regular expression literal is kept where live code uses it, whatever becomes of literals in branches that are cut.
declare const console: { log(...args: unknown[]): void }
const never: boolean = false as const
function clean(s: string): string {
  if (never) return s.replace(/sourceOfExpressionInDeadBranch\d+/g, "")
  return s.replace(/sourceOfLiveExpression\d+/g, "<>")
}
const live = /anotherLive(Expression)?/y
console.log(clean("a sourceOfLiveExpression12 b"), live.source, live.flags, String(/writtenOut[a-z]+/giu), new RegExp("made" + "AtRunTime", "s").source)
