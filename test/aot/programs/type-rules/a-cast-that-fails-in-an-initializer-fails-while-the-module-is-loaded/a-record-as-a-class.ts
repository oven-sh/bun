class Point { x = 1; norm(): number { return this.x; } }
function asPoint(value: object): Point { return value as Point; }
export const made = asPoint({ y: 2 });
