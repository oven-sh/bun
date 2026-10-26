// What the components here import from svelte 5.57.2, as it declares it. Svelte is under the MIT License: svelte.LICENSE.md.

declare const SnippetReturn: unique symbol;

export interface Snippet<Parameters extends unknown[] = []> {
  (
    this: void,
    ...args: number extends Parameters["length"] ? never : Parameters
  ): {
    "{@render ...} must be called with a Snippet": "import type { Snippet } from 'svelte'";
  } & typeof SnippetReturn;
}

export type Subscriber<T> = (value: T) => void;
export type Unsubscriber = () => void;

export interface Readable<T> {
  subscribe(this: void, run: Subscriber<T>, invalidate?: () => void): Unsubscriber;
}

// What `ComponentProps<typeof X>` is for a component that the program does not know.
export type ComponentProps<Comp> = Record<string, any>;
