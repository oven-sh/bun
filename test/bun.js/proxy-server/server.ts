let server = Bun.serve({
    async fetch(request: Request) {
        // if (request.method == "CONNECT") {
            
        // }
        console.log(request.method, request.url, request.headers.toJSON());
        return new Response("Tea Break~", { status: 418 });
    },
    port: 54321,
});
