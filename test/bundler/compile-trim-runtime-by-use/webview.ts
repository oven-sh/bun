const WebView: any = Bun.WebView;
console.log(typeof WebView, WebView.name, WebView.length);
console.log(Object.getOwnPropertyNames(WebView.prototype).sort().join(" "));
WebView.closeAll();
