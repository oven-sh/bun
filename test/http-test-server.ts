import { serve } from "bun";

// This is obviously incomplete but these are probably the most common status codes + the ones we need for testing
type ValidStatusCode = 200 | 201 | 400 | 404 | 405 | 500;

const defaultOpts = {
  type: "json",
  headers: {
    "Content-Type": "application/json",
  },
  status: 200,
};

const defaultResponseBodies = {
  200: "OK",
  201: "Created",
  400: "Bad Request",
  404: "Not Found",
  405: "Method Not Allowed",
  500: "Internal Server Error",
} as Record<ValidStatusCode, string>;

function getDefaultJSONBody(request: Request) {
  return {
    url: request.url,
    method: request.method,
  };
}

function makeTestJsonResponse(
  request: Request,
  opts: ResponseInit & { type?: "plaintext" | "json" } = { status: 200, type: "json" },
  body?: { [k: string | number]: any } | string,
): Response {
  const defaultJSONBody = getDefaultJSONBody(request);

  let type = opts.type || "json";
  let resBody;
  let headers;

  // Setup headers

  if (!opts.headers) headers = new Headers();

  if (!(opts.headers instanceof Headers)) headers = new Headers(opts.headers);
  else headers = opts.headers;

  switch (type) {
    case "json":
      if (typeof body === "object" && body !== null) {
        resBody = JSON.stringify({ ...defaultJSONBody, ...body }) as string;
      } else if (typeof body === "string") {
        resBody = JSON.stringify({ ...defaultJSONBody, data: body }) as string;
      } else {
        resBody = JSON.stringify(defaultJSONBody) as string;
      }
      // Check to set headers
      headers.set("Content-Type", "application/json");
      break;
    case "plaintext":
      if (typeof body === "object") {
        if (body === null) {
          resBody = "";
        } else {
          resBody = JSON.stringify(body);
        }
      }
      // Check to set headers
      headers.set("Content-Type", "text/plain");
      break;
    default:
  }

  return new Response(resBody as string, {
    ...defaultOpts,
    ...opts,
    headers: { ...defaultOpts.headers, ...headers },
  });
}

export function createServer() {
  const server = serve({
    port: 0,
    fetch: async req => {
      const { pathname, search } = new URL(req.url);
      const lowerPath = pathname.toLowerCase();

      let response: Response;
      switch (lowerPath.match(/\/\w+/)?.[0] || "") {
        // START HTTP METHOD ROUTES
        case "/get":
          if (req.method.toUpperCase() !== "GET") {
            response = makeTestJsonResponse(req, { status: 405 });
            break;
          }
          if (search !== "") {
            const params = new URLSearchParams(search);
            const args = {} as Record<string, string | number>;
            params.forEach((v, k) => {
              if (!isNaN(parseInt(v))) {
                args[k] = parseInt(v);
              } else {
                args[k] = v;
              }
            });
            response = makeTestJsonResponse(req, { status: 200 }, { args });
            break;
          }
          // Normal case
          response = makeTestJsonResponse(req);
          break;
        case "/post":
          if (req.method.toUpperCase() !== "POST") {
            response = makeTestJsonResponse(req, { status: 405 });
            break;
          }
          response = makeTestJsonResponse(req, { status: 201, type: "json" }, await req.text());
          break;
        case "/head":
          if (req.method.toUpperCase() !== "HEAD") {
            response = makeTestJsonResponse(req, { status: 405 });
            break;
          }
          response = makeTestJsonResponse(req, { status: 200 });
          break;

        // END HTTP METHOD ROUTES

        case "/status":
          // Parse the status from URL path params: /status/200
          const rawStatus = lowerPath.split("/").filter(Boolean)[1];
          if (rawStatus) {
            const status = parseInt(rawStatus);
            if (!isNaN(status) && status > 100 && status < 599) {
              response = makeTestJsonResponse(
                req,
                { status },
                { data: defaultResponseBodies[(status || 200) as ValidStatusCode] },
              );
              break;
            }
          }
          response = makeTestJsonResponse(req, { status: 400 }, { data: "Invalid status" });
          break;
        case "/delay":
          const rawDelay = lowerPath.split("/").filter(Boolean)[1];
          if (rawDelay) {
            const delay = parseInt(rawDelay);
            if (!isNaN(delay) && delay >= 0) {
              await Bun.sleep(delay * 1000);
              response = makeTestJsonResponse(req, { status: 200 }, { data: "Delayed" });
              break;
            }
          }
          response = makeTestJsonResponse(req, { status: 400 }, { data: "Invalid delay" });
          break;
        case "/headers":
          response = makeTestJsonResponse(req, { status: 200 }, { headers: req.headers });
          break;
        default:
          response = makeTestJsonResponse(req, { status: 404 });
      }

      return response;
    },
  });
  return server;
}
