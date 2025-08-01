const previewServerPort = parseInt(process.argv[2], 10);
function expect(value) {
  return {
    toBe: expected => {
      if (value !== expected) {
        throw new Error(`Expected ${value} to be ${expected}`);
      }
    },
  };
}
const origin = `http://localhost:${previewServerPort}`;
const r = await fetch(`${origin}/_actions/getGreeting/`, {
  body: '{"name":"World"}',
  headers: {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9,es;q=0.8",
    "content-type": "application/json",
    "sec-ch-ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    Referer: origin,
    "Referrer-Policy": "strict-origin-when-cross-origin",
  },
  method: "POST",
});
expect(r.status).toBe(200);
const text = await r.text();
expect(text).toBe('["Hello, World!"]');
