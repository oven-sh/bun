import React from "react";
import classNames from "classnames";

const LINKS = [
  { text: "Documentation", url: "https://bun.sh/docs" },
  { text: "GitHub", url: "https://github.com/oven-sh/bun" },
  { text: "Discord", url: "https://bun.sh/discord" },
  { text: "Blog", url: "https://bun.sh/blog" },
];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-logo">
          <span className="logo-small">🥟</span>
          <span className="footer-text">Built with Bun</span>
        </div>
        <nav className="footer-links">
          {LINKS.map(({ text, url }) => (
            <a
              key={text}
              href={url}
              className={classNames("footer-link", "hover:text-accent")}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
