// Framework server entry point for app-plugins-release.ts. Never bundled: the
// probe starts and stops dev servers without ever requesting a route.
export function render() {
  return new Response("unused");
}
