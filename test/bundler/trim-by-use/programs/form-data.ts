const form = new FormData();
form.append("name", "value");
form.append("file", new Blob(["abc"], { type: "text/plain" }), "a.txt");
const response = new Response(form);
console.log(
  response.headers.get("content-type")!.startsWith("multipart/form-data; boundary="),
  [...form.keys()].join(),
);
const parsed = await response.formData();
console.log(parsed.get("name"), (parsed.get("file") as File).name, await (parsed.get("file") as File).text());
const encoded = await new Response("a=1&b=2", {
  headers: { "content-type": "application/x-www-form-urlencoded" },
}).formData();
console.log(encoded.get("b"), form);
