import { declA, constA } from "./cycA";
export function fromB() { return "fromB+" + declA(); }
export const constB = () => "constB";
export function callsConstA() { return constA(); }
export const duringB = (() => { let r = declA(); try { r += "," + constA(); } catch (e: any) { r += "," + e.constructor.name; } return r; })();
