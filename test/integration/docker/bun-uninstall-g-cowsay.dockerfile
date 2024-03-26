FROM oven/bun
RUN bun install -g cowsay \
  && which cowsay \
  && bun uninstall -g cowsay \
  && which cowsay && echo "FAIL" || echo "PASS"
