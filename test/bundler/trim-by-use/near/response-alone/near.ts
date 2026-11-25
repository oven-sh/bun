const response = new Response("cargo", { status: 201 });
console.log(response.status, await response.text());
const request = new Request("http://localhost/crate", { method: "POST", body: "cargo" });
console.log(request.method, await request.text());
