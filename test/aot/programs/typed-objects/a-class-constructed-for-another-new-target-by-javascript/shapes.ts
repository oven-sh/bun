export class Shape { sides: number; label = "shape"; constructor(sides: number) { this.sides = sides; } hi(): string { return "Shape.hi " + this.label + this.sides; } }
export function total(list: Shape[]): number { let sides = 0; for (const each of list) sides += each.sides; return sides; }
