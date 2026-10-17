class Base { constructor() { console.log(this.size()); } size(): number { return 0; } }
class Derived extends Base { xs: number[] = [1, 2]; size(): number { try { return this.xs.length; } catch (e) { return -1; } } }
console.log(new Derived().size());
export {};
