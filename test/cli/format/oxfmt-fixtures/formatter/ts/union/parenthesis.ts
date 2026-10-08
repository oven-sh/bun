type T1<B> = | (B extends any ? number : string);
type T2 = | (() => void);
