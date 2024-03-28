FROM oven/bun
RUN bun install -g cowsay \
  && cowsay "Hello, World!" \
  # FIXME: 'node': No such file or directory
  # `bun install -g` could change shebang from node to bun?
  || true
