/* @jsxRuntime classic */
/* @jsx make */
const make = (tag: any): any => (typeof tag === "string" ? "[" + tag + "]" : tag());
const Button = () => <button />;
const Unused = () => <input />;
export const ui = { Button };
