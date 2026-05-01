import React from "react";
import classNames from "classnames";

export default function Hero() {
  return (
    <div className="hero">
      <div className={classNames("logo", "animate-bounce")}>🥟</div>
      <h1>
        Welcome to <span className="gradient-text">Bun</span>
      </h1>
      <p className="description">
        The all-in-one JavaScript runtime & toolkit designed for speed
      </p>
      <div className="cta-buttons">
        <a
          href="https://bun.com"
          className={classNames("button", "primary")}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get Started
        </a>
        <a
          href="https://github.com/oven-sh/bun"
          className={classNames("button", "secondary")}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub
        </a>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="stat-value">3x</span>
          <span className="stat-label">Bun Bun Bun</span>
        </div>
        <div className="stat">
          <span className="stat-value">0.5s</span>
          <span className="stat-label">Average Install Time</span>
        </div>
        <div className="stat">
          <span className="stat-value">Extremely</span>
          <span className="stat-label">Node.js Compatible</span>
        </div>
      </div>
    </div>
  );
}
