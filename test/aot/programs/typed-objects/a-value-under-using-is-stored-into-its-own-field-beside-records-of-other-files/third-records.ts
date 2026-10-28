const printValue = console.log;
class Holder<T> {}
interface O11Shape {}
type O11 = { [K in keyof O11Shape]: O11Shape[K] };
interface O20Base<T0 = C66> {}
interface O20 extends O20Base<C66> {}
interface O61All {
  a?: O61 | null;
  c: O20;
  d: O11;
}
type O61 = Omit<O61All, "leftOut">;
const v13: O11 = {
  // @ts-ignore
  [v4 as any](): bigint {
    let v6: bigint = 10 as any;
    const v12: O11 = {
      next(): O61 {
        const v10 = (v6 as any) == (0 as any);
        const v11: O61 = { done: v10, value: v6 } as unknown as O61;
        return v11;
      },
    } as any;
    return v12 as any;
  },
} as any;
printValue("v13", v13);
const v40: string[] = {
  // @ts-ignore
  [v35 as any](): O20 {},
} as any;
function F44(a46, a47, a48 = v43 as any, a49) {
  function f50<T66 = any>(a51: T66): void {}
}
class C66 {}
