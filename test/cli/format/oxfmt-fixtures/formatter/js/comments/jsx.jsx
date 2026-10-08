<div
  key={formMessageId} // Use a unique key to help with animations
  initial={{ opacity: 0, y: -5, height: 0 }} // Start slightly hidden
  animate={{ opacity: 1, y: 0, height: "auto" }} // Fade in and slide up
  exit={{ opacity: 0, y: -5, height: 0 }} // Fade out and slide back up
  transition={{ duration: 0.15, ease: "easeInOut" }} // Smooth transition
  style={{ /* comment */ overflow: "hidden" /* comment */  }}
></div>;

// https://github.com/oxc-project/oxc/issues/17226
someFunction(
  <Component
    value1={{
      foo: "bar",
    }}
  />,
  // {
  //   option: true,
  // },
);
