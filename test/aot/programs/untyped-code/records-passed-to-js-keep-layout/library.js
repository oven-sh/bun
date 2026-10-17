export const held = [];
export function hold(value) { held.push(value); return held.length - 1; }
export function same(index, value) { return held[index] === value; }
export function identity(value) { return value; }
export function graftKept(node) { const made = { value: 100, left: undefined, right: undefined }; held.push(made); node.left = made; return node.left === made; }
export function changeKept(by) { const made = held[held.length - 1]; made.value += by; return made.value; }
export function extendKept() { const made = held[held.length - 1]; made.note = "n"; return Object.keys(made).join(); }
export function graftTyped(node, other) { node.right = other; return node.right === other; }
export function swap(pair) { const first = pair.first; pair.first = pair.second; pair.second = first; return pair; }
export function setInMap(map, key) { const made = { x: 7, y: 8 }; held.push(made); map.set(key, made); return map.size; }
export function addToSet(set) { const made = { x: 1, y: 1 }; set.add(made); return set.size; }
export function pushInto(list) { const made = { x: 20, y: 30 }; held.push(made); list.push(made); return list.length; }
export function replaceAt(list, index) { const made = { x: 2, y: 3 }; list[index] = made; return list[index] === made; }
export function sortByX(list) { return list.sort((a, b) => b.x - a.x); }
export function mapToSums(list) { return list.map(p => p.x + p.y); }
export function keysOf(value) { const names = []; for (const name in value) names.push(name); return names.join() + "|" + Object.keys(value).join() + "|" + JSON.stringify(value); }
export function copyOf(value) { return { ...value }; }
export function assignTo(target, source) { return Object.assign(target, source); }
export function entriesOf(value) { return Object.entries(value).map(([k, v]) => k + "=" + (typeof v === "object" && v ? "{" + Object.keys(v).join() + "}" : String(v))).join(); }
export function resolveLater(value) { return Promise.resolve(value); }
export function thenMake() { return Promise.resolve({ x: 3, y: 4 }); }
export function callWith(callback, x, y) { const made = { x, y }; held.push(made); return callback(made); }
export function callMethod(object, x) { return object.move({ x, y: x }); }
export class View { constructor(options) { this.options = options; } width() { return this.options.size.x; } grow() { this.options.size = { x: this.options.size.x + 1, y: 0 }; return this; } }
export function setOptional(value) { value.label = "set"; return value; }
export function clearOptional(value) { value.label = undefined; return value; }
export function setUnion(value, flag) { value.kind = flag ? "a" : "b"; value.data = flag ? { x: 1, y: 2 } : 5; return value; }
export function nest(outer) { outer.inner.point.x += 1; outer.inner = { point: { x: 50, y: 60 } }; return outer; }
export function weakly(value) { const map = new WeakMap(); map.set(value, 1); return map.has(value) && map.get(value); }
export function describeType(value) { return Object.prototype.toString.call(value) + " " + (value.constructor === Object) + " " + (Object.getPrototypeOf(value) === Object.prototype) + " " + value.hasOwnProperty("x") + " " + ("x" in value) + " " + Object.getOwnPropertyNames(value).join(); }
export function destructure({ x, y, ...rest }) { return x + ":" + y + ":" + Object.keys(rest).join(); }
export function viaArguments(first, second) { return arguments[0].x + arguments.length; }
export function viaApply(f, value) { return f.apply(null, [value]) + f.call(null, value); }
export function increment(counter) { counter.count++; counter.count += 1; counter.total = counter.total + 0.5; return counter; }
export function big(counter) { counter.count = 2 ** 40; return counter; }
export function negativeZero(counter) { counter.count = -0; return counter; }
export function notANumber(counter) { counter.total = NaN; return counter; }
export function walk(node, depth) { let sum = node.value; if (node.left) sum += walk(node.left, depth + 1); if (node.right) sum += walk(node.right, depth + 1); return sum + depth; }
export function scale(point, by) { point.x = point.x * by; point.y = point.y * by; return point; }
export function remove(point) { delete point.x; return point; }
export function extend(point) { point.extra = 1; return point; }
export function accessor(point) { let reads = 0; Object.defineProperty(point, "x", { get() { return ++reads; }, configurable: true, enumerable: true }); return point; }
export function freeze(point) { return Object.freeze(point); }
export function reparent(point) { Object.setPrototypeOf(point, { inherited: 7 }); return point; }
