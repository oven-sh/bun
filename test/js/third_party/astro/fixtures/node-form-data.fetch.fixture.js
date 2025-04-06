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
const formData = new FormData();
formData.append("name", "John Doe");
formData.append("email", "john.doe@example.com");
const origin = `http://localhost:${previewServerPort}`;
const r = await fetch(`${origin}/form-data`, {
  "body": formData,
  "headers": {
    "origin": origin,
  },
  "method": "POST",
});

expect(r.status).toBe(200);
const text = await r.text();
expect(text).toBe(
  JSON.stringify({
    name: "John Doe",
    email: "john.doe@example.com",
  }),
);
