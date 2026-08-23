// A mock CDP endpoint: a Bun.serve WebSocket speaking just enough of the
// protocol for navigate(), reload() and goBack() to work, and leaving every
// evaluate() a scenario sends unanswered so it is still in flight when the
// connection goes away. Used by webview-chrome-disconnect.test.ts: inside a
// scenario process, and in the test process itself for the --isolate case,
// where the views connect from a child `bun test`.

export interface MockCDP {
  /** ws:// URL for `backend.url`. */
  url: string;
  /** "open" and "close" in the order the server saw them. */
  events: string[];
  /** While true, a committed navigation is followed by Page.loadEventFired so
   * the op resolves. Scenarios turn it off to leave a navigation committed
   * but never loaded. */
  completeLoads: boolean;
  emit(method: string, params: unknown, sessionId?: string): void;
  /** Abrupt connection loss, as if the browser died. */
  drop(): void;
  stop(): void;
  newView(): Bun.WebView;
}

export function startMockCDP(): MockCDP {
  let sock: Bun.ServerWebSocket<undefined> | undefined;
  let targets = 0;
  let loads = 0;
  let lastUrl = "about:blank";
  const mock = {
    events: [] as string[],
    completeLoads: true,
    emit(method: string, params: unknown, sessionId?: string) {
      sock!.send(JSON.stringify(sessionId ? { method, params, sessionId } : { method, params }));
    },
    drop() {
      sock!.terminate();
    },
  } as MockCDP;
  function commit(sessionId: string | undefined, url: string, loaderId: string) {
    lastUrl = url;
    mock.emit(
      "Page.frameNavigated",
      { frame: { id: "F", loaderId, url, mimeType: "text/html" }, type: "Navigation" },
      sessionId,
    );
    if (mock.completeLoads) mock.emit("Page.loadEventFired", { timestamp: loads }, sessionId);
  }
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      open(ws) {
        sock = ws;
        mock.events.push("open");
      },
      close() {
        mock.events.push("close");
      },
      message(ws, raw) {
        const { id, method, params = {}, sessionId } = JSON.parse(String(raw));
        const reply = (result: unknown) =>
          ws.send(JSON.stringify(sessionId ? { id, result, sessionId } : { id, result }));
        switch (method) {
          case "Target.createTarget":
            targets++;
            return reply({ targetId: "T" + targets });
          case "Target.attachToTarget":
            return reply({ sessionId: "S" + params.targetId.slice(1) });
          case "Page.navigate": {
            const loaderId = "L" + ++loads;
            reply({ frameId: "F", loaderId });
            return commit(sessionId, params.url, loaderId);
          }
          case "Page.reload":
            reply({});
            return commit(sessionId, lastUrl, "L" + ++loads);
          case "Page.getNavigationHistory":
            return reply({
              currentIndex: 1,
              entries: [
                { id: 1, url: "about:blank" },
                { id: 2, url: lastUrl },
              ],
            });
          case "Page.navigateToHistoryEntry":
            reply({});
            return commit(sessionId, "about:blank", "L" + ++loads);
          case "Runtime.evaluate":
            // The backend fetches document.title after every load; answer
            // that. Any evaluate() a scenario sends itself is deliberately
            // left unanswered, so it is still waiting for a reply when the
            // connection goes away.
            if (params.expression === "document.title") return reply({ result: { type: "string", value: "mock" } });
            return;
          default:
            return reply({});
        }
      },
    },
  });
  mock.url = "ws://127.0.0.1:" + server.port + "/devtools/browser/mock";
  mock.stop = () => server.stop(true);
  mock.newView = () => new Bun.WebView({ backend: { type: "chrome", url: mock.url }, width: 100, height: 100 });
  return mock;
}
