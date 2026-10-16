import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/broken")({
  loader: () => {
    throw new RangeError("out of range");
  },
  errorComponent: ({ error }) => <p role="alert">{error.message}</p>,
  component: () => <p>never</p>,
});
