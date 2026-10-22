// current => (current.state === "s3" ? { ...current, saving: true } : current): one arm brings the copy, one member of the union; the other brings the rest of the union.
// Their join lists more layouts than either arm. Past the limit on the layouts in a type, which the flags beside this file lower, the join is only "object",
// and the cast to the declared result, which had been found to change nothing while the second arm still listed the whole union, has to go on holding.
// The function is handed to code that nobody sees, so its parameter and its result are tested.
type Status =
  | { state: "s0"; value0: number; saving?: boolean }
  | { state: "s1"; value1: number; saving?: boolean }
  | { state: "s2"; value2: number; saving?: boolean }
  | { state: "s3"; value3: number; saving?: boolean }
  | { state: "s4"; value4: number; saving?: boolean }
  | { state: "s5"; value5: number; saving?: boolean }
  | { state: "s6"; value6: number; saving?: boolean }
  | { state: "s7"; value7: number; saving?: boolean }
  | { state: "s8"; value8: number; saving?: boolean }
  | { state: "s9"; value9: number; saving?: boolean }
  | { state: "s10"; value10: number; saving?: boolean }
  | { state: "s11"; value11: number; saving?: boolean }
  | { state: "s12"; value12: number; saving?: boolean }
  | { state: "s13"; value13: number; saving?: boolean };
let status: Status = { state: "s0", value0: 0 };
const setStatus: (update: (current: Status) => Status) => void =
  (globalThis as any).hookFromOutside ??
  (update => {
    status = update(status);
  });
const all: Status[] = [
  { state: "s0", value0: 0 },
  { state: "s1", value1: 1 },
  { state: "s2", value2: 2 },
  { state: "s3", value3: 3 },
  { state: "s4", value4: 4 },
  { state: "s5", value5: 5 },
  { state: "s6", value6: 6 },
  { state: "s7", value7: 7 },
  { state: "s8", value8: 8 },
  { state: "s9", value9: 9 },
  { state: "s10", value10: 10 },
  { state: "s11", value11: 11 },
  { state: "s12", value12: 12 },
  { state: "s13", value13: 13 },
];
for (const next of all) {
  status = next;
  setStatus(current => (current.state === "s3" ? { ...current, saving: true } : current));
  console.log(status.state, status.saving);
}
