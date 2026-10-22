function helper(text: string) { return "<" + text + ">"; }
export function star() { return helper("star"); }
export function named() { return helper("named"); }
export function zero() { return helper("renamed three times"); }
export default function () { return helper("was the default"); }
export function becomesDefault() { return helper("becomes the default"); }
export class Klass {
  method() { return helper("class"); }
}
export const constant = () => helper("constant");
export function nobodyImportsThis() { return helper("nobody"); }
