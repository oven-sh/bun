const holder: { nothing: null; missing: undefined } = { nothing: null, missing: undefined };
const wide: { nothing: number | null; missing: string | undefined } = holder;

console.log(holder.nothing, holder.missing);
wide.nothing = 0;
wide.missing = "found";
console.log(holder.nothing);
console.log(holder.nothing === null);
console.log(holder.nothing ?? "default");
console.log(typeof holder.nothing);
console.log(holder.missing);
console.log(holder.missing === undefined);
console.log(holder.missing ?? "default");
console.log(typeof holder.missing);
