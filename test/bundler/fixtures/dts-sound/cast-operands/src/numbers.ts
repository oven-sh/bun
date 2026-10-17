export const smaller = (left: bigint, right: bigint): bigint => (left < right ? left : right);
export const succeed = <A>(value: A): { value: A } => ({ value });
export const zero = 0n;
export const first = (): string => "first";
export const second = (): string => "second";
