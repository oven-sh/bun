import { EventStream, serve } from "bun";

serve({
  port: 3000,
  fetch(req) {
    return new Response(
      new EventStream({
        start(controller) {
          setTimeout(() => {
            controller.send("hi");
            // controller.close();
          }, 1000);
        },
        cancel() {
          console.log("CANCEL");
        },
      }),
      {
        headers: {
          "Content-Bruh": "text/bruh",
          "Content-Length": "452",
        },
      },
    );
  },
});

// // serve({
// //   port: 3000,
// //   fetch(req) {
// //     return new Response(new Blob(["hello world"], { type: "custom/type" }));
// //   },
// // });
