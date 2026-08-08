import { expectType } from "./utilities";

// https://github.com/oven-sh/bun/issues/30754
// Bun.WebView's runtime exposes goBack()/goForward() (registered on the
// prototype in src/runtime/webview/JSWebViewPrototype.cpp); the types once
// advertised back()/forward(), which never existed at runtime.

declare const webview: Bun.WebView;

expectType(webview.goBack()).is<Promise<void>>();
expectType(webview.goForward()).is<Promise<void>>();

// The legacy names must stay rejected. The directives below are only
// satisfied while back()/forward() are absent from the type; reintroducing
// either makes the directive unused and fails this fixture's typecheck.
// @ts-expect-error runtime API uses goBack(), not back()
webview.back();
// @ts-expect-error runtime API uses goForward(), not forward()
webview.forward();
