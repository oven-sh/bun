// An enum's members are computed from members of other enums, of itself and from constants. Only the last enum of each chain is named by code that runs; some members are read as constants, some through a computed name, some backwards.
const base = 10;
enum First { A = 1, B = A + 1, C = B * 2 }
enum Second { X = First.C, Y = First.B + X }
enum Third { P = Second.Y, Q = P + base }
enum Words { Hello = "hello", World = "world" }
enum Sentences { Greeting = Words.Hello }
enum Unused { Nothing = First.A }
enum OnlyAType { T = 5 }
enum ByComputedName { K = 7, L = 8 }
enum Backwards { M = 9 }
enum Flags { None = 0, Read = 1 << 0, Write = 1 << 1, Both = Read | Write }
declare enum Declared { D = 1 }

let typed: OnlyAType | undefined;
console.log(Third.P, Third.Q, Sentences.Greeting, typed);
console.log(ByComputedName[("K" + "") as "K"], Backwards[9], Flags.Both, Flags[Flags.Both], Object.keys(Flags).length);
