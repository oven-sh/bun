import axios from "axios";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  ...[
    http.get("http://localhost/", () => {
      // return passthrough()
      return HttpResponse.json({ results: [{}, {}] });
    }),
  ],
);
server.listen({
  onUnhandledRequest: "warn",
});

axios
  .get("http://localhost/?page=2")
  .then(function (response) {
    // handle success
    console.log(response.data.results.length);
  })
  .catch(function (error) {
    // handle error
    console.log(error?.message);
  });
