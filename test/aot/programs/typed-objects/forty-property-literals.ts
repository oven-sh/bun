interface Wide {
  f0: number;
  f1: number;
  f2: number;
  f3?: number;
  f4: number;
  f5: number;
  f6: number;
  f7: number;
  f8: number;
  f9: number;
  f10?: number;
  f11: number;
  f12: number;
  f13: number;
  f14: number;
  f15: number;
  f16: number;
  f17?: number;
  f18: number;
  f19: number;
  f20: number;
  f21: number;
  f22: number;
  f23: number;
  f24?: number;
  f25: number;
  f26: number;
  f27: number;
  f28: number;
  f29: number;
  f30: number;
  f31?: number;
  f32: number;
  f33: number;
  f34: number;
  f35: number;
  f36: number;
  f37: number;
  f38?: number;
  f39: number;
  run: (by: number) => number;
}
type Tagged = { kind: "a"; a0: number; a1: number; a2: number; a3: number; a4: number; a5: number; a6: number; a7: number; a8: number; a9: number; a10: number; a11: number; a12: number; a13: number; a14: number; a15: number; a16: number; a17: number; a18: number; a19: number; a20: number; a21: number; a22: number; a23: number; a24: number; a25: number; a26: number; a27: number; a28: number; a29: number; a30: number; a31: number; a32: number; a33: number; a34: number; a35: number; a36: number; a37: number; a38: number; a39: number; } | { kind: "b"; b0: string; b1: string; b2: string; b3: string; b4: string; b5: string; b6: string; b7: string; b8: string; b9: string; b10: string; b11: string; b12: string; b13: string; b14: string; b15: string; b16: string; b17: string; b18: string; b19: string; b20: string; b21: string; b22: string; b23: string; b24: string; b25: string; b26: string; b27: string; b28: string; b29: string; b30: string; b31: string; b32: string; b33: string; b34: string; b35: string; b36: string; b37: string; b38: string; b39: string; };
const own = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
  p4: 4,
  p5: 5,
  p6: 6,
  p7: 7,
  p8: 8,
  p9: 9,
  p10: 10,
  p11: 11,
  p12: 12,
  p13: 13,
  p14: 14,
  p15: 15,
  p16: 16,
  p17: 17,
  p18: 18,
  p19: 19,
  p20: 20,
  p21: 21,
  p22: 22,
  p23: 23,
  p24: 24,
  p25: 25,
  p26: 26,
  p27: 27,
  p28: 28,
  p29: 29,
  p30: 30,
  p31: 31,
  p32: 32,
  p33: 33,
  p34: 34,
  p35: 35,
  p36: 36,
  p37: 37,
  p38: 38,
  p39: 39,
  twice: () => 2,
};
const wide: Wide = {
  f39: 78,
  f37: 74,
  f36: 72,
  f35: 70,
  f34: 68,
  f33: 66,
  f32: 64,
  f30: 60,
  f29: 58,
  f28: 56,
  f27: 54,
  f26: 52,
  f25: 50,
  f23: 46,
  f22: 44,
  f21: 42,
  f20: 40,
  f19: 38,
  f18: 36,
  f16: 32,
  f15: 30,
  f14: 28,
  f13: 26,
  f12: 24,
  f11: 22,
  f9: 18,
  f8: 16,
  f7: 14,
  f6: 12,
  f5: 10,
  f4: 8,
  f2: 4,
  f1: 2,
  f0: 0,
  run: by => by + 1,
};
const tagged: Tagged[] = [{ kind: "a", a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, a10: 10, a11: 11, a12: 12, a13: 13, a14: 14, a15: 15, a16: 16, a17: 17, a18: 18, a19: 19, a20: 20, a21: 21, a22: 22, a23: 23, a24: 24, a25: 25, a26: 26, a27: 27, a28: 28, a29: 29, a30: 30, a31: 31, a32: 32, a33: 33, a34: 34, a35: 35, a36: 36, a37: 37, a38: 38, a39: 39 }, { b0: "s0", b1: "s1", b2: "s2", b3: "s3", b4: "s4", b5: "s5", b6: "s6", b7: "s7", b8: "s8", b9: "s9", b10: "s10", b11: "s11", b12: "s12", b13: "s13", b14: "s14", b15: "s15", b16: "s16", b17: "s17", b18: "s18", b19: "s19", b20: "s20", b21: "s21", b22: "s22", b23: "s23", b24: "s24", b25: "s25", b26: "s26", b27: "s27", b28: "s28", b29: "s29", b30: "s30", b31: "s31", b32: "s32", b33: "s33", b34: "s34", b35: "s35", b36: "s36", b37: "s37", b38: "s38", b39: "s39", kind: "b" }];
const more: { p1?: number; extra: string } = { p1: -1, extra: "e" };
const spreadBehind = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
  p4: 4,
  p5: 5,
  p6: 6,
  p7: 7,
  p8: 8,
  p9: 9,
  p10: 10,
  p11: 11,
  p12: 12,
  p13: 13,
  p14: 14,
  p15: 15,
  p16: 16,
  p17: 17,
  p18: 18,
  p19: 19,
  p20: 20,
  p21: 21,
  p22: 22,
  p23: 23,
  p24: 24,
  p25: 25,
  p26: 26,
  p27: 27,
  p28: 28,
  p29: 29,
  p30: 30,
  p31: 31,
  p32: 32,
  p33: 33,
  p34: 34,
  p35: 35,
  p36: 36,
  p37: 37,
  p38: 38,
  p39: 39,
  ...more,
  last: true,
};
const spreadAhead = {
  ...more,
  p0: 1,
  p1: 2,
  p2: 3,
  p3: 4,
  p4: 5,
  p5: 6,
  p6: 7,
  p7: 8,
  p8: 9,
  p9: 10,
  p10: 11,
  p11: 12,
  p12: 13,
  p13: 14,
  p14: 15,
  p15: 16,
  p16: 17,
  p17: 18,
  p18: 19,
  p19: 20,
  p20: 21,
  p21: 22,
  p22: 23,
  p23: 24,
  p24: 25,
  p25: 26,
  p26: 27,
  p27: 28,
  p28: 29,
  p29: 30,
  p30: 31,
  p31: 32,
  p32: 33,
  p33: 34,
  p34: 35,
  p35: 36,
  p36: 37,
  p37: 38,
  p38: 39,
  p39: 40,
};
const withAccessor = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
  p4: 4,
  p5: 5,
  p6: 6,
  p7: 7,
  p8: 8,
  p9: 9,
  p10: 10,
  p11: 11,
  p12: 12,
  p13: 13,
  p14: 14,
  p15: 15,
  p16: 16,
  p17: 17,
  p18: 18,
  p19: 19,
  p20: 20,
  p21: 21,
  p22: 22,
  p23: 23,
  p24: 24,
  p25: 25,
  p26: 26,
  p27: 27,
  p28: 28,
  p29: 29,
  p30: 30,
  p31: 31,
  p32: 32,
  p33: 33,
  p34: 34,
  p35: 35,
  p36: 36,
  p37: 37,
  p38: 38,
  p39: 39,
  get sum() { return this.p1 + this.p39; },
};
const small = { a: 1, b: 2, a2: 3 };
function total(of: Record<string, unknown>): number {
  let sum = 0;
  for (const key of Object.keys(of)) if (typeof of[key] === "number") sum += of[key] as number;
  return sum;
}
console.log(total(own), own.p3, own.twice(), Object.keys(own).length, Object.keys(own)[3]);
console.log(total(wide as unknown as Record<string, unknown>), wide.f3, wide.f4, wide.run(1), Object.keys(wide)[0]);
console.log(tagged.map(one => (one.kind === "a" ? one.a39 : one.b39)).join(), Object.keys(tagged[1]).pop());
console.log(spreadBehind.p1, spreadBehind.extra, spreadBehind.last, spreadAhead.p1, spreadAhead.extra, Object.keys(spreadAhead)[0], withAccessor.sum, total(small));
