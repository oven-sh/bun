interface S0 { kind: "s0"; a0: number }
interface S1 { kind: "s1"; a1: number }
interface S2 { kind: "s2"; a2: number }
interface S3 { kind: "s3"; a3: number }
interface S4 { kind: "s4"; a4: number }
interface S5 { kind: "s5"; a5: number }
interface S6 { kind: "s6"; a6: number }
interface S7 { kind: "s7"; a7: number }
interface S8 { kind: "s8"; a8: number }
interface S9 { kind: "s9"; a9: number }
interface S10 { kind: "s10"; a10: number }
interface S11 { kind: "s11"; a11: number }
interface S12 { kind: "s12"; a12: number }
interface S13 { kind: "s13"; a13: number }
interface S14 { kind: "s14"; a14: number }
interface S15 { kind: "s15"; a15: number }
interface S16 { kind: "s16"; a16: number }
interface S17 { kind: "s17"; a17: number }
interface S18 { kind: "s18"; a18: number }
interface S19 { kind: "s19"; a19: number }
type S = S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 | S16 | S17 | S18 | S19;
interface Box<T> { held: T }
interface Big { id: number; more: string }
interface Small { id: number }
interface H0 { kind: "h0"; on0: (from: Big) => Small }
interface H1 { kind: "h1"; on1: (from: Big) => Small }
interface H2 { kind: "h2"; on2: (from: Big) => Small }
interface H3 { kind: "h3"; on3: (from: Big) => Small }
interface H4 { kind: "h4"; on4: (from: Big) => Small }
interface H5 { kind: "h5"; on5: (from: Big) => Small }
interface H6 { kind: "h6"; on6: (from: Big) => Small }
interface H7 { kind: "h7"; on7: (from: Big) => Small }
interface H8 { kind: "h8"; on8: (from: Big) => Small }
interface H9 { kind: "h9"; on9: (from: Big) => Small }
interface H10 { kind: "h10"; on10: (from: Big) => Small }
interface H11 { kind: "h11"; on11: (from: Big) => Small }
interface H12 { kind: "h12"; on12: (from: Big) => Small }
interface H13 { kind: "h13"; on13: (from: Big) => Small }
interface H14 { kind: "h14"; on14: (from: Big) => Small }
interface H15 { kind: "h15"; on15: (from: Big) => Small }
interface H16 { kind: "h16"; on16: (from: Big) => Small }
interface H17 { kind: "h17"; on17: (from: Big) => Small }
interface H18 { kind: "h18"; on18: (from: Big) => Small }
interface H19 { kind: "h19"; on19: (from: Big) => Small }
type H = H0 | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | H11 | H12 | H13 | H14 | H15 | H16 | H17 | H18 | H19 | Box<Small> | { [key: string]: Small } | ((from: Big) => Small);
function pick(s: S): number {
  if (s.kind === "s0") return s.a0;
  if (s.kind === "s1") return s.a1;
  if (s.kind === "s2") return s.a2;
  if (s.kind === "s3") return s.a3;
  if (s.kind === "s4") return s.a4;
  if (s.kind === "s5") return s.a5;
  if (s.kind === "s6") return s.a6;
  if (s.kind === "s7") return s.a7;
  if (s.kind === "s8") return s.a8;
  if (s.kind === "s9") return s.a9;
  if (s.kind === "s10") return s.a10;
  if (s.kind === "s11") return s.a11;
  if (s.kind === "s12") return s.a12;
  if (s.kind === "s13") return s.a13;
  if (s.kind === "s14") return s.a14;
  if (s.kind === "s15") return s.a15;
  if (s.kind === "s16") return s.a16;
  if (s.kind === "s17") return s.a17;
  if (s.kind === "s18") return s.a18;
  return s.a19;
}
const all: S[] = [{ kind: "s0", a0: 0 }, { kind: "s1", a1: 1 }, { kind: "s2", a2: 2 }, { kind: "s3", a3: 3 }, { kind: "s4", a4: 4 }, { kind: "s5", a5: 5 }, { kind: "s6", a6: 6 }, { kind: "s7", a7: 7 }, { kind: "s8", a8: 8 }, { kind: "s9", a9: 9 }, { kind: "s10", a10: 10 }, { kind: "s11", a11: 11 }, { kind: "s12", a12: 12 }, { kind: "s13", a13: 13 }, { kind: "s14", a14: 14 }, { kind: "s15", a15: 15 }, { kind: "s16", a16: 16 }, { kind: "s17", a17: 17 }, { kind: "s18", a18: 18 }, { kind: "s19", a19: 19 }];
const big: Big = { id: 7, more: "m" };
const boxed: Box<Big> = { held: big };
const byKey: { [key: string]: Big } = { one: big };
const handler: H3 = { kind: "h3", on3: from => ({ id: from.id + 1 }) };
const plain = (from: Small): Big => ({ id: from.id + 2, more: "f" });
const taken: H[] = [boxed, byKey, handler, plain];
function idOf(h: H): number {
  if (typeof h === "function") return h(big).id;
  if ("held" in h) return (h as Box<Small>).held.id;
  if ("kind" in h && typeof h.kind === "string") return (h as H3).on3(big).id;
  return (h as { [key: string]: Small }).one.id;
}
console.log(all.map(pick).join(), taken.map(idOf).join());
