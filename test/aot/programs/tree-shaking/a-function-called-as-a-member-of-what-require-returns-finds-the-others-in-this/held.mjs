export function start() { return "start, " + this.afterStart(); }
export function afterStart() { return "after start"; }
export function optional() { return "optional, " + this.afterOptional(); }
export function afterOptional() { return "after optional"; }
export function tag() { return "tag, " + this.afterTag(); }
export function afterTag() { return "after tag"; }
export function bracketed() { return "bracketed, " + this.afterBracketed(); }
export function afterBracketed() { return "after bracketed"; }
