// A module augmentation of `./html`. The program has this file before html.d.ts: TypeScript 6 still merges it after.
export {};

declare module "./html" {
  export interface HTMLAttributes<T> {
    "data-preload-code"?: true | false | "" | "eager" | "viewport" | "hover" | "tap" | undefined | null;
    "data-preload-data"?: true | false | "" | "hover" | "tap" | undefined | null;
    "data-reload"?: true | false | "" | undefined | null;
    "data-replace-state"?: true | false | "" | undefined | null;
    "data-reset"?: true | false | "" | undefined | null;
  }
}
