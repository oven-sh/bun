function aboveTheLastIndex(x: string): string {
  try {
    const v: Record<string, string> = { ["4294967295"]: x };
    return v["4294967295"];
  } finally {
  }
}
function startsWithADigit(x: string): Record<string, string> {
  try {
    const v: Record<string, string> = { ["1a"]: x };
    return v;
  } finally {
  }
}
function anIndexAndTwoNames(x: string): Record<string, string> {
  try {
    const v: Record<string, string> = { ["0"]: x, a: x + "a", b: x + "b" };
    return v;
  } finally {
  }
}
function neverRead(x: string): void {
  try {
    const v: Record<string, string> = { ["4294967295"]: x };
  } finally {
  }
}
console.log(aboveTheLastIndex("a"));
console.log(JSON.stringify(startsWithADigit("b")));
console.log(JSON.stringify(anIndexAndTwoNames("c")));
neverRead("d");
console.log("ok");
