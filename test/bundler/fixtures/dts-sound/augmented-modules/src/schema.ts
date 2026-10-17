export declare namespace Annotations {
  interface Augment {}
  interface All extends Augment {
    readonly title?: string;
  }
}
export interface Options {
  readonly strict?: boolean;
}
export function annotate(annotations: Annotations.All, options: Options): string[] {
  return [...Object.keys(annotations), ...Object.keys(options)];
}
