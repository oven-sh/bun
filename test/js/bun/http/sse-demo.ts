import { EventStream, serve } from "bun";

serve({
  port: 3000,
  fetch(req) {
    let timer: Timer;
    return new Response(
      new EventStream({
        async start(controller) {
          timer = setInterval(() => {
            controller.send("hi");
          }, 1000);
        },
        cancel() {
          clearInterval(timer);
        },
      }),
      // {
      //   headers: {
      //     "Content-Bruh": "text/bruh",
      //     "Content-Length": "452",
      //   },
      // },
    );
  },
});

// // // serve({
// // //   port: 3000,
// // //   fetch(req) {
// // //     return new Response(new Blob(["hello world"], { type: "custom/type" }));
// // //   },
// // // });
