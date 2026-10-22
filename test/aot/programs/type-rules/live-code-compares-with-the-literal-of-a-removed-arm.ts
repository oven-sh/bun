// A build that removes an arm makes no new type error in live code: the result that the checker infers is TypeScript's, with the literal of the removed arm in it.
function mode(fast: boolean) {
  if (false) {
    return "dev";
  }
  if (fast) return "fast";
  return "prod";
}
function shape(fast: boolean) {
  if (false) {
    return { kind: "dev" as const, trace: "t" };
  }
  return fast ? { kind: "fast" as const } : { kind: "prod" as const };
}
function compared(fast: boolean): string {
  return mode(fast) === "dev" ? "development" : "other";
}
function switched(fast: boolean): string {
  switch (mode(fast)) {
    case "dev":
      return "never";
    case "fast":
      return "quick";
    default:
      return "slow";
  }
}
function read(fast: boolean): string {
  const made = shape(fast);
  return made.kind === "dev" ? made.trace : made.kind;
}
console.log(compared(true), switched(true), switched(false), read(true), read(false));
