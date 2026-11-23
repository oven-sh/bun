// Each layout has fields that an object gets only later, one of them of a type of its own. Whoever stores them first creates them.
function m0(i: number) { const o: { a: number; u0: number; b?: string; level?: number; inner?: { x0: number } | null } = { a: i, u0: 0 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x0: i }; } return o; }
function m1(i: number) { const o: { a: number; u1: number; b?: string; level?: number; inner?: { x1: number } | null } = { a: i, u1: 1 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x1: i }; } return o; }
function m2(i: number) { const o: { a: number; u2: number; b?: string; level?: number; inner?: { x2: number } | null } = { a: i, u2: 2 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x2: i }; } return o; }
function m3(i: number) { const o: { a: number; u3: number; b?: string; level?: number; inner?: { x3: number } | null } = { a: i, u3: 3 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x3: i }; } return o; }
function m4(i: number) { const o: { a: number; u4: number; b?: string; level?: number; inner?: { x4: number } | null } = { a: i, u4: 4 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x4: i }; } return o; }
function m5(i: number) { const o: { a: number; u5: number; b?: string; level?: number; inner?: { x5: number } | null } = { a: i, u5: 5 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x5: i }; } return o; }
function m6(i: number) { const o: { a: number; u6: number; b?: string; level?: number; inner?: { x6: number } | null } = { a: i, u6: 6 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x6: i }; } return o; }
function m7(i: number) { const o: { a: number; u7: number; b?: string; level?: number; inner?: { x7: number } | null } = { a: i, u7: 7 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x7: i }; } return o; }
function m8(i: number) { const o: { a: number; u8: number; b?: string; level?: number; inner?: { x8: number } | null } = { a: i, u8: 8 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x8: i }; } return o; }
function m9(i: number) { const o: { a: number; u9: number; b?: string; level?: number; inner?: { x9: number } | null } = { a: i, u9: 9 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x9: i }; } return o; }
function m10(i: number) { const o: { a: number; u10: number; b?: string; level?: number; inner?: { x10: number } | null } = { a: i, u10: 10 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x10: i }; } return o; }
function m11(i: number) { const o: { a: number; u11: number; b?: string; level?: number; inner?: { x11: number } | null } = { a: i, u11: 11 }; if (i < 0) { o.b = "x"; o.level = 1; o.inner = { x11: i }; } return o; }
export const makers: ((i: number) => Record<string, unknown>)[] = [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11];
