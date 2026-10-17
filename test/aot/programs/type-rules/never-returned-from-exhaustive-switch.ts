type Read = { kind: "miss"; reason: "absent" | "expired" | "disabled" } | { kind: "hit"; value: number };
function isMiss(read: Extract<Read, { kind: "miss" }>): boolean {
  switch (read.reason) {
    case "absent":
    case "expired":
      return true;
    case "disabled":
      return false;
    default:
      return read.reason satisfies never;
  }
}
const label = (read: Extract<Read, { kind: "miss" }>): string => (read.reason === "absent" ? "a" : read.reason === "expired" ? "e" : read.reason === "disabled" ? "d" : (read.reason satisfies never));
const reads: Extract<Read, { kind: "miss" }>[] = [{ kind: "miss", reason: "absent" }, { kind: "miss", reason: "disabled" }, { kind: "miss", reason: "expired" }];
for (const read of reads) console.log(isMiss(read), label(read));
