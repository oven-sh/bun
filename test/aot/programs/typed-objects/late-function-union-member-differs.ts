interface In0 { shared: number; own0?: string }
interface In1 { shared: number; own1?: string }
interface In2 { shared: number; own2?: string }
interface In3 { shared: number; own3?: string }
interface In4 { shared: number; own4?: string }
interface In5 { shared: number; own5?: string }
interface In6 { shared: number; own6?: string }
interface In7 { shared: number; own7?: string }
interface In8 { shared: number; own8?: string }
interface In9 { shared: number; own9?: string }
interface In10 { shared: number; own10?: string }
interface In11 { shared: number; own11?: string }
interface In12 { shared: number; own12?: string }
interface In13 { shared: number; own13?: string }
interface In14 { shared: number; own14?: string }
interface In15 { shared: number; own15?: string }
interface In16 { shared: number; own16?: string }
interface In17 { shared: number; own17?: string }
interface In18 { shared: number; own18?: string }
interface In19 { shared: number; own19?: string }
interface In20 { shared: number; own20?: string }
interface In21 { shared: number; own21?: string }
interface In22 { shared: number; own22?: string }
interface In23 { shared: number; own23?: string }
interface Other { text: string }
interface Handlers {
  h0: (input: In0, times: number) => number;
  h1: (input: In1, times: number) => number;
  h2: (input: In2, times: number) => number;
  h3: (input: In3, times: number) => number;
  h4: (input: In4, times: number) => number;
  h5: (input: In5, times: number) => number;
  h6: (input: In6, times: number) => number;
  h7: (input: In7, times: number) => number;
  h8: (input: In8, times: number) => number;
  h9: (input: In9, times: number) => number;
  h10: (input: In10, times: number) => number;
  h11: (input: In11, times: number) => number;
  h12: (input: In12, times: number) => number;
  h13: (input: In13, times: number) => number;
  h14: (input: In14, times: number) => number;
  h15: (input: In15, times: number) => number;
  h16: (input: In16, times: number) => number;
  h17: (input: In17, times: number) => number;
  h18: (input: In18, times: number) => number;
  h19: (input: In19, times: number) => number;
  h20: (input: In20, times: number) => number;
  h21: (input: In21, times: number) => number;
  h22: (input: In22, times: number) => number;
  h23: (input: In23, times: number) => number;
  last: (input: Other) => number;
}
const handlers: Handlers = {
  h0(input, times) { return input.shared * times + 0 + (input.own0 ? input.own0.length : 0); },
  h1(input, times) { return input.shared * times + 1 + (input.own1 ? input.own1.length : 0); },
  h2(input, times) { return input.shared * times + 2 + (input.own2 ? input.own2.length : 0); },
  h3(input, times) { return input.shared * times + 3 + (input.own3 ? input.own3.length : 0); },
  h4(input, times) { return input.shared * times + 4 + (input.own4 ? input.own4.length : 0); },
  h5(input, times) { return input.shared * times + 5 + (input.own5 ? input.own5.length : 0); },
  h6(input, times) { return input.shared * times + 6 + (input.own6 ? input.own6.length : 0); },
  h7(input, times) { return input.shared * times + 7 + (input.own7 ? input.own7.length : 0); },
  h8(input, times) { return input.shared * times + 8 + (input.own8 ? input.own8.length : 0); },
  h9(input, times) { return input.shared * times + 9 + (input.own9 ? input.own9.length : 0); },
  h10(input, times) { return input.shared * times + 10 + (input.own10 ? input.own10.length : 0); },
  h11(input, times) { return input.shared * times + 11 + (input.own11 ? input.own11.length : 0); },
  h12(input, times) { return input.shared * times + 12 + (input.own12 ? input.own12.length : 0); },
  h13(input, times) { return input.shared * times + 13 + (input.own13 ? input.own13.length : 0); },
  h14(input, times) { return input.shared * times + 14 + (input.own14 ? input.own14.length : 0); },
  h15(input, times) { return input.shared * times + 15 + (input.own15 ? input.own15.length : 0); },
  h16(input, times) { return input.shared * times + 16 + (input.own16 ? input.own16.length : 0); },
  h17(input, times) { return input.shared * times + 17 + (input.own17 ? input.own17.length : 0); },
  h18(input, times) { return input.shared * times + 18 + (input.own18 ? input.own18.length : 0); },
  h19(input, times) { return input.shared * times + 19 + (input.own19 ? input.own19.length : 0); },
  h20(input, times) { return input.shared * times + 20 + (input.own20 ? input.own20.length : 0); },
  h21(input, times) { return input.shared * times + 21 + (input.own21 ? input.own21.length : 0); },
  h22(input, times) { return input.shared * times + 22 + (input.own22 ? input.own22.length : 0); },
  h23(input, times) { return input.shared * times + 23 + (input.own23 ? input.own23.length : 0); },
  last(input) { return input.text.length; },
};
const kept: unknown[] = [];
function keep(value: unknown): void { kept.push(value); }
function pick<K extends keyof Handlers>(name: K): Handlers[K] {
  const handler = handlers[name];
  keep(handler);
  return handler;
}
let sum = 0;
sum += pick("h0")({ shared: 2 }, 3);
sum += pick("h7")({ shared: 5, own7: "seven" }, 2);
sum += pick("h23")({ shared: 1 }, 1);
sum += pick("last")({ text: "four" });
for (const value of kept) {
  const called = (value as (input: { shared: number; text: string }, times: number) => number)({ shared: 1, text: "ab" }, 10);
  sum += called;
}
console.log(sum, kept.length, typeof kept[0]);
