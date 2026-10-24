export interface Dial { level: number; inner: { a: number }; turn(this: Dial, to: number): number }
function turnTo(this: Dial, to: number): number { this.level = to; return this.level + 7; }
export default turnTo;
