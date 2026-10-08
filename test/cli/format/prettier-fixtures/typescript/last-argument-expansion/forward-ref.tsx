export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(props, ref) {
    return <ThemeUILink ref={ref} variant="default" {...props} />;
  }
);

export const LinkWithLongName = forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(props, ref) {
    return <ThemeUILink ref={ref} variant="default" {...props} />;
  }
);

export const Arrow = forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  return <ThemeUILink ref={ref} variant="default" {...props} />;
});

export const ArrowWithLongName = forwardRef<HTMLAnchorElement, LinkProps>(
  (props, ref) => {
    return <ThemeUILink ref={ref} variant="default" {...props} />;
  }
);

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  function Link(props, ref) {
    return <ThemeUILink ref={ref} variant="default" {...props} />;
  },
);
