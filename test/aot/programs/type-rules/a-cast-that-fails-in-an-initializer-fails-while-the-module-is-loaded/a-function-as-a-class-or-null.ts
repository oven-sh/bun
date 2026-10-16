class Point { x = 1; norm(): number { return this.x; } }
function asPoint(value: object): Point | null { return value as Point | null; }
export const made = asPoint(() => 1);
