declare const process: { argv: string[] };
class Bag { items: number[]; constructor(early: boolean) { if (early) console.log(this.size()); this.items = [1]; } size(): number { try { return this.items.length; } catch (e) { return -1; } } }
console.log(new Bag(process.argv[2] === "1").size());
export {};
