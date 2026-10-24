export function alter(target) { target.more = { n: 2 }; target.count = "many"; return target; }
export function spoil(point) { point.x = "text"; return point; }
export function fill(list) { list.push({ x: "pushed" }); list[0] = { y: 1 }; return list; }
export function call(callback) { return callback({ x: "given", y: [1] }); }
export function put(map) { map.set("k", { x: null }); return map; }
export class Holder { constructor(held) { this.held = held; } change() { this.held.x = { deep: true }; return this; } }
