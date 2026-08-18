import { expectType } from "./utilities";

expectType(Bun.markdown.html("$x$", { latexMath: true, underline: true })).is<string>();
expectType(Bun.markdown.render("_x_", {}, { underline: true })).is<string>();

Bun.markdown.react(
  "$x$ $$y$$ _z_",
  {
    math: ({ display, children }) => {
      expectType(display).is<true | undefined>();
      expectType(children).is<Bun.markdown.ChildrenProps["children"]>();
      return null;
    },
    u: ({ children }) => {
      expectType(children).is<Bun.markdown.ChildrenProps["children"]>();
      return null;
    },
  },
  { latexMath: true, underline: true },
);

// A component that only takes children still satisfies the math override.
const Plain = (props: Bun.markdown.ChildrenProps) => props.children;
Bun.markdown.react("$x$", { math: Plain, u: Plain }, { latexMath: true });

// @ts-expect-error
Bun.markdown.html("$x$", { latexMath: "yes" });
