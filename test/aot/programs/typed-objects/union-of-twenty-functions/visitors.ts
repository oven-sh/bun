export interface Tree<T> { value: T; children?: Tree<T>[]; up?: Tree<T> }
export interface Q0 { shared: Tree<number>; own0: Tree<{ k0: number; next?: Q0 }> }
export interface Q1 { shared: Tree<number>; own1: Tree<{ k1: number; next?: Q1 }> }
export interface Q2 { shared: Tree<number>; own2: Tree<{ k2: number; next?: Q2 }> }
export interface Q3 { shared: Tree<number>; own3: Tree<{ k3: number; next?: Q3 }> }
export interface Q4 { shared: Tree<number>; own4: Tree<{ k4: number; next?: Q4 }> }
export interface Q5 { shared: Tree<number>; own5: Tree<{ k5: number; next?: Q5 }> }
export interface Q6 { shared: Tree<number>; own6: Tree<{ k6: number; next?: Q6 }> }
export interface Q7 { shared: Tree<number>; own7: Tree<{ k7: number; next?: Q7 }> }
export interface Q8 { shared: Tree<number>; own8: Tree<{ k8: number; next?: Q8 }> }
export interface Q9 { shared: Tree<number>; own9: Tree<{ k9: number; next?: Q9 }> }
export interface Q10 { shared: Tree<number>; own10: Tree<{ k10: number; next?: Q10 }> }
export interface Q11 { shared: Tree<number>; own11: Tree<{ k11: number; next?: Q11 }> }
export interface Q12 { shared: Tree<number>; own12: Tree<{ k12: number; next?: Q12 }> }
export interface Q13 { shared: Tree<number>; own13: Tree<{ k13: number; next?: Q13 }> }
export interface Q14 { shared: Tree<number>; own14: Tree<{ k14: number; next?: Q14 }> }
export interface Q15 { shared: Tree<number>; own15: Tree<{ k15: number; next?: Q15 }> }
export interface Q16 { shared: Tree<number>; own16: Tree<{ k16: number; next?: Q16 }> }
export interface Q17 { shared: Tree<number>; own17: Tree<{ k17: number; next?: Q17 }> }
export interface Q18 { shared: Tree<number>; own18: Tree<{ k18: number; next?: Q18 }> }
export interface Q19 { shared: Tree<number>; own19: Tree<{ k19: number; next?: Q19 }> }
export type Visitors = {
  v0: (q: Q0) => number;
  v1: (q: Q1) => number;
  v2: (q: Q2) => number;
  v3: (q: Q3) => number;
  v4: (q: Q4) => number;
  v5: (q: Q5) => number;
  v6: (q: Q6) => number;
  v7: (q: Q7) => number;
  v8: (q: Q8) => number;
  v9: (q: Q9) => number;
  v10: (q: Q10) => number;
  v11: (q: Q11) => number;
  v12: (q: Q12) => number;
  v13: (q: Q13) => number;
  v14: (q: Q14) => number;
  v15: (q: Q15) => number;
  v16: (q: Q16) => number;
  v17: (q: Q17) => number;
  v18: (q: Q18) => number;
  v19: (q: Q19) => number;
};
export const visitors: Visitors = {
  v0: q => q.shared.value + q.own0.value.k0,
  v1: q => q.shared.value + q.own1.value.k1,
  v2: q => q.shared.value + q.own2.value.k2,
  v3: q => q.shared.value + q.own3.value.k3,
  v4: q => q.shared.value + q.own4.value.k4,
  v5: q => q.shared.value + q.own5.value.k5,
  v6: q => q.shared.value + q.own6.value.k6,
  v7: q => q.shared.value + q.own7.value.k7,
  v8: q => q.shared.value + q.own8.value.k8,
  v9: q => q.shared.value + q.own9.value.k9,
  v10: q => q.shared.value + q.own10.value.k10,
  v11: q => q.shared.value + q.own11.value.k11,
  v12: q => q.shared.value + q.own12.value.k12,
  v13: q => q.shared.value + q.own13.value.k13,
  v14: q => q.shared.value + q.own14.value.k14,
  v15: q => q.shared.value + q.own15.value.k15,
  v16: q => q.shared.value + q.own16.value.k16,
  v17: q => q.shared.value + q.own17.value.k17,
  v18: q => q.shared.value + q.own18.value.k18,
  v19: q => q.shared.value + q.own19.value.k19,
};
