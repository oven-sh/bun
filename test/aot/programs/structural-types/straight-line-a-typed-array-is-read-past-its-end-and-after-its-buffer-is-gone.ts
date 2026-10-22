const view = new Float64Array([0.5, 1.5]);
const past: number = view[2];
console.log(typeof past);
console.log(past + 1);
console.log(past | 0);
console.log(past === 0);
console.log(view[-1]);
console.log(view[0.5]);
console.log(view[-0]);
view[2] = 9;
view[-1] = 9;
console.log(view.length);
console.log(Object.keys(view).join());

const ints = new Int32Array([1, 2]);
const pastInts: number = ints[2];
console.log(typeof pastInts);
console.log(pastInts + 1);
console.log(pastInts | 0);

const moved = view.buffer.transfer();
console.log(moved.byteLength);
console.log(view.length);
const gone: number = view[0];
console.log(typeof gone);
console.log(gone + 1);
view[0] = 3;
console.log(view[0]);
console.log(view.byteLength);

const buffer = new ArrayBuffer(16, { maxByteLength: 32 });
const tracking = new Float64Array(buffer);
tracking[1] = 2.5;
console.log(tracking.length);
buffer.resize(8);
console.log(tracking.length);
const cutOff: number = tracking[1];
console.log(typeof cutOff);
console.log(cutOff + 1);
buffer.resize(24);
console.log(tracking.length);
console.log(tracking[1]);
console.log(tracking[2]);

export {};
