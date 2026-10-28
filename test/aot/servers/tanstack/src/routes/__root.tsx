import { HeadContent, Link, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Servers that answer the same routes" },
      { name: "description", content: "A small TanStack Start application." },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        <nav>
          <Link to="/" activeProps={{ className: "active" }} activeOptions={{ exact: true }}>
            Home
          </Link>{" "}
          <Link to="/items" activeProps={{ className: "active" }}>
            Items
          </Link>{" "}
          <Link to="/contacts" activeProps={{ className: "active" }}>
            Contacts
          </Link>
        </nav>
        <hr />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
