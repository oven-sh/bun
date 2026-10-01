import { fromB, constB, callsConstA } from "./cycB";
export function declA() { return "declA"; }
export const constA = () => "constA";
export const early = (() => { try { return callsConstA(); } catch (e: any) { return e.constructor.name; } })();
export function useB() { return fromB() + "," + constB(); }
