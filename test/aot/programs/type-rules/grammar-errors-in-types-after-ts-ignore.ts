// Plain Bun skips a type without looking at its parameter names or at where a rest parameter is, so these errors are TypeScript's own: below a `@ts-ignore` the program builds and runs.
// @ts-ignore
type Rest = (...a: number[], b: string) => void;
// @ts-ignore
type Reserved = (public: boolean) => void;
const rest: Rest = () => {};
const reserved: Reserved = () => {};
console.log(typeof rest, typeof reserved);
export {};
