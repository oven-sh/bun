import { expectType } from "./utilities";

// https://github.com/oven-sh/bun/issues/30754
// The runtime (src/runtime/webview/JSWebViewPrototype.cpp) names the history
// methods goBack() and goForward().
declare const view: Bun.WebView;

expectType(view.goBack()).is<Promise<void>>();
expectType(view.goForward()).is<Promise<void>>();
expectType(view.reload()).is<Promise<void>>();

// @ts-expect-error back() does not exist at runtime
view.back();
// @ts-expect-error forward() does not exist at runtime
view.forward();

export {};
