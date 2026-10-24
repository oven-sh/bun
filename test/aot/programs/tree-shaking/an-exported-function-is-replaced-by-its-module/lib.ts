export let viaLet = function () { return "let: first"; };
export function declared() { return "declaration: first"; }
export default function byDefault() { return "default: first"; }

function secondLet() { return "let: second"; }
function secondDeclared() { return "declaration: second"; }
function secondDefault() { return "default: second"; }

export function swap() {
  viaLet = secondLet;
  (declared as any) = secondDeclared;
  (byDefault as any) = secondDefault;
}
