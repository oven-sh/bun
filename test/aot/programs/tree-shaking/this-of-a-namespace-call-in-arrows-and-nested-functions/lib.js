export function throughArrow() { return (() => this.reachedFromArrow())(); }
export function reachedFromArrow() { return "reached from an arrow"; }
function callOn(object) { return object["reachedBy" + "Helper"](); }
export function handsItOn() { return callOn(this); }
export function reachedByHelper() { return "reached by a helper"; }
export function takesItApart() { const { reachedByPattern } = this; return reachedByPattern(); }
export function reachedByPattern() { return "reached by a pattern"; }
export function nestedFunction() { return (function () { return typeof this; })(); }
