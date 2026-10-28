declare const process: { argv: string[] };
interface Node { children?: number[]; }
const nodes: Node[] = [{ children: [1, 2] }, {}];
function count(n: Node): number { try { return n.children!.length; } catch (e) { return -1; } }
console.log(count(nodes[Number(process.argv[2] ?? 0)]));
export {};
