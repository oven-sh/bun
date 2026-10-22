export * as inner from "./inner.mjs";
export function quoted() { return "quoted"; }
export function optional() { return "optional"; }
export function parenthesized() { return "parenthesized"; }
export class Klass { method() { return "method"; } }
function held() { return "held by the default export"; }
export default { held };
export function tag() { return "tag"; }
export function onlyTypeof() {}
export function underWith() { return "under with"; }
export function inCallback() { return "in a callback"; }
export function inCondition() { return "in a condition"; }
