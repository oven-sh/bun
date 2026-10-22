export function plain() { return "plain"; }
export function quoted() { return "quoted"; }
export function template() { return "template"; }
export function optional() { return "optional"; }
export function optionalCall() { return "optional call"; }
export function nonNull() { return "non-null"; }
export function cast() { return "cast"; }
export function satisfied() { return "satisfied"; }
export function parenthesized() { return "parenthesized"; }
export function comma() { return "comma"; }
export function viaCall() { return "via call"; }
export function tag(strings: TemplateStringsArray) { return "tag " + strings[0]; }
export class Constructed {
  value() { return "constructed"; }
}
export function onlyTypeof() { return "only typeof"; }
export function onlyName() { return "only name"; }
export function onlyLength(a: number, b: number) { return "only length"; }
export function unused() { return "unused"; }
