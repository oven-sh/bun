console.log("Current bun canary has a memory leak. This file will overload your system ram until the OS kills it.");
console.log("");
prompt("Press enter to continue");

const num = 100;
const results = await Promise.all(
  new Array(num).fill(0).map((_, i) =>
    Bun.build({
      entrypoints: ["./expectBundled.ts"],
      plugins: [
        {
          name: "overload_host",
          setup(build) {
            build.onResolve({ filter: /.*/ }, args => {
              Bun.gc(true);
              return {
                path: args.path,
                namespace: "overload_host",
              };
            });
          },
        },
      ],
    }),
  ),
);
console.log(results);
