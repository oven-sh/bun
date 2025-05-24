import { gunzipJsonRequest } from "harness";
import { resolveBulkAdvisoryFixture } from "./registry/fixtures/audit/audit-fixtures";

console.log(
  `${
    Bun.serve({
      fetch: async req => {
        const body = await gunzipJsonRequest(req);

        const fixture = resolveBulkAdvisoryFixture(body);

        console.log("FIXTURE", fixture);

        if (!fixture) {
          return new Response("No fixture found", { status: 404 });
        }

        return Response.json(fixture);
      },
      port: 3000,
    }).url
  }`,
);
