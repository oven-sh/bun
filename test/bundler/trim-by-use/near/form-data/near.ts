const response = new Response("a=1&b=2", { headers: { "content-type": "application/x-www-form-urlencoded" } });
console.log(
  await response.text(),
  new URLSearchParams("a=1&b=2").get("b"),
  await new Response(new URLSearchParams({ c: "3" })).text(),
  await new Blob(["x"]).text(),
  await new Request("http://x/", { method: "POST", body: "y" }).json().catch(() => "no json"),
);
console.log(response, new Blob(["x"]));
