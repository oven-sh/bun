foo = foo`\u{prettier}\u{0065}`;
foo = html`\u{prettier}\u{0065}`;
foo = graphql`\u{prettier}\u{0065}`;
foo = markdown`\u{prettier}\u{0065}`;
foo = css`\u{prettier}\u{0065}`;
foo = /* HTML */`\u{prettier}\u{0065}`;
foo = /* GraphQL */`\u{prettier}\u{0065}`;

foo = foo`\u{prettier}${foo}pr\u{0065}ttier`;
foo = html`\u{prettier}${foo}pr\u{0065}ttier`;
foo = graphql`\u{prettier}${foo}pr\u{0065}ttier`;
foo = markdown`\u{prettier}${foo}pr\u{0065}ttier`;
foo = css`\u{prettier}${foo}pr\u{0065}ttier`;
foo = /* HTML */`\u{prettier}${foo}pr\u{0065}ttier`;
foo = /* GraphQL */`\u{prettier}${foo}pr\u{0065}ttier`;

foo = foo`pr\u{0065}ttier${foo}\u{prettier}`;
foo = html`pr\u{0065}ttier${foo}\u{prettier}`;
foo = graphql`pr\u{0065}ttier${foo}\u{prettier}`;
foo = markdown`pr\u{0065}ttier${foo}\u{prettier}`;
foo = css`pr\u{0065}ttier${foo}\u{prettier}`;
foo = /* HTML */`pr\u{0065}ttier${foo}\u{prettier}`;
foo = /* GraphQL */`pr\u{0065}ttier${foo}\u{prettier}`;

foo = foo`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
foo = html`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
foo = graphql`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
foo = markdown`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
foo = css`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
foo = /* HTML */`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
foo = /* GraphQL */`pr\u{0065}ttier${foo}\u{prettier}${bar}pr\u{0065}ttier`;
