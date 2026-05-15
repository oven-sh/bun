import { expectType } from "./utilities";

// https://github.com/oven-sh/bun/issues/30754
// Bun.WebView's runtime exposes goBack()/goForward(). The types must
// match those names, not the legacy back()/forward() that never existed
// at runtime.

declare const view: Bun.WebView;

expectType(view.goBack()).is<Promise<void>>();
expectType(view.goForward()).is<Promise<void>>();

// Sanity: the other navigation helpers the reporter used.
expectType(view.navigate("https://example.com")).is<Promise<void>>();
expectType(view.reload()).is<Promise<void>>();
