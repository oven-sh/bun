async function json(req: Request) {
  if (req.headers.get("content-encoding") === "gzip") {
    const buf = await req.arrayBuffer();
    const inflated = Bun.gunzipSync(buf);
    return JSON.parse(Buffer.from(inflated).toString("utf-8"));
  }

  return await req.json();
}

Bun.serve({
  fetch: async req => {
    console.log(req.url);

    if (req.method !== "GET") {
      const body = await json(req);

      const key = JSON.stringify(body);
      if (fixtures[key]) {
        return Response.json(fixtures[key]);
      }
    }

    return Response.json({});
  },
  port: 9000,
});

const fixtures = {
  [JSON.stringify({ "is-number": ["7.0.0"], "ms": ["0.7.0"] })]: {},
};
