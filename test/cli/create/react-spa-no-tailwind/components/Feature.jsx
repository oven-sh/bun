import React from "react";
import classNames from "classnames";

export default function Feature({ icon, title, description, highlight }) {
  return (
    <div className={classNames("feature", "hover:scale-105")}>
      <div className="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>
        {highlight ? (
          <>
            {description.split(highlight).map((part, i, arr) => (
              <React.Fragment key={i}>
                {part}
                {i < arr.length - 1 && (
                  <span className="highlight">{highlight}</span>
                )}
              </React.Fragment>
            ))}
          </>
        ) : (
          description
        )}
      </p>
    </div>
  );
}
