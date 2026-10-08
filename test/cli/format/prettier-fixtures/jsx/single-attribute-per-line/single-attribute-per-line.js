import React from "react";

const Component = () => (
  <div>
    <div data-a="1">
      Lorem ipsum dolor sit amet, consectetur adipiscing elit.
    </div>

    <div data-a="1" data-b="2" data-c="3">
      Lorem ipsum dolor sit amet, consectetur adipiscing elit.
    </div>

    <div data-a="Lorem ipsum dolor sit amet" data-b="Lorem ipsum dolor sit amet" data-c="Lorem ipsum dolor sit amet">
      Lorem ipsum dolor sit amet, consectetur adipiscing elit.
    </div>

    <div data-long-attribute-a="1" data-long-attribute-b="2" data-long-attribute-c="3">
      Lorem ipsum dolor sit amet, consectetur adipiscing elit.
    </div>

    <img src="/images/foo.png" />

    <img src="/images/foo.png" alt="bar" />

    <img src="/images/foo.png" alt="Lorem ipsum dolor sit amet, consectetur adipiscing elit." />
  </div>
);
