// https://babeljs.io/docs/babel-plugin-syntax-import-meta

// Enabled by default https://github.com/babel/babel/pull/11406

// from https://github.com/tc39/proposal-import-meta

(async () => {
  const response = await fetch(new URL("../hamsters.jpg", import.meta.url));
  const blob = await response.blob();

  const size = import.meta.scriptElement.dataset.size || 300;

  const image = new Image();
  image.src = URL.createObjectURL(blob);
  image.width = image.height = size;

  document.body.appendChild(image);
})();
