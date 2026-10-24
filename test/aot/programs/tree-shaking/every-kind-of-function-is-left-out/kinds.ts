export function used() { return "used"; }
export function plain() { return 1; }
export async function asynchronous() { return 1; }
export function* generator() { yield 1; }
export async function* asyncGenerator() { yield 1; }
export const arrow = () => 1;
export const expression = function () { return 1; };
export class Klass { constructor(public a = 1) {} method() { return this.a; } static make() { return new Klass(); } get b() { return 1; } }
export class Sub extends Klass { constructor() { super(2); } override method() { return super.method(); } }
export default class Default { method() { return 1; } }
export abstract class Shape { abstract area(): number; describe() { return this.area(); } }
function notExported() { return plain() + new Klass().method(); }
const alsoNot = async () => notExported();
