export function initialize() {
  const handler = () => {
    console.log("SIGINT");
  };

  const handler2 = () => {
    console.log("SIGTERM");
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler2);
  process.off("SIGTERM", handler2);
  process.off("SIGINT", handler);

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler2);
  process.off("SIGTERM", handler2);
  process.off("SIGINT", handler);

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler2);
  process.off("SIGTERM", handler2);
  process.off("SIGINT", handler);
}

initialize();
