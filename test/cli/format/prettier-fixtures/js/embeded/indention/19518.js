const t = html`
  <ol>
    ${items.map(
      (entry) => html`
        <li>
          ${entry.children
            ? html`
                <ol>
                  ${entry.children.map(
                    (child) => html`<li>${child.title}</li>`,
                  )}
                </ol>
              `
            : entry.title}
        </li>
      `,
    )}
  </ol>
`;

export function foo() {
  return html`
    <div>
              <pre>${JSON.stringify({
                  a: 1,
                  b: 2,
                })}</pre>
    </div>
  `;
}

const a = html`
          ${{
              c: y,
          }}
`;
