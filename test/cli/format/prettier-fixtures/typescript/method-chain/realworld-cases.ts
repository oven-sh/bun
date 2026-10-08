// https://github.com/mdn/content/blob/923adb616baa87402ca965ebd18a73380cc84d27/files/en-us/mozilla/add-ons/webextensions/api/browsersettings/tlsversionrestrictionconfig/index.md?plain=1#L25
browser.browserSettings.tlsVersionRestrictionConfig.maximum
  .get({})
  .then((result) => {
    console.log(`Highest TLS version supported: ${result}`);
  });

// https://github.com/mdn/content/blob/923adb616baa87402ca965ebd18a73380cc84d27/files/en-us/web/api/animation/pause/index.md?plain=1#L38
const nommingCake = document
  .getElementById("eat-me_sprite")
  .animate(
    [{ transform: "translateY(0)" }, { transform: "translateY(-80%)" }],
    {
      fill: "forwards",
      easing: "steps(4, end)",
      duration: aliceChange.effect.timing.duration / 2,
    },
  );

// https://github.com/mdn/content/blob/923adb616baa87402ca965ebd18a73380cc84d27/files/en-us/web/api/element/fullscreenchange_event/index.md?plain=1#L75
document
  .getElementById("toggle-fullscreen")
  .addEventListener("click", (event) => {
    if (document.fullscreenElement) {
      // exitFullscreen is only available on the Document object.
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  });

// https://github.com/mdn/content/blob/923adb616baa87402ca965ebd18a73380cc84d27/files/en-us/web/api/htmlelement/focus/index.md?plain=1#L98
document
  .getElementById("focusButtonVisibleIndication")
  .addEventListener("click", () => {
    document.getElementById("myButton").focus({ focusVisible: true });
  });

function replacePlaceholders(quasisDoc, expressionDocs) {
  const newDoc = mapDoc(cleanDoc(quasisDoc), (doc) => {
    // When we have multiple placeholders in one line, like:
    // ${Child}${Child2}:not(:first-child)
    return doc
      .split(/@prettier-placeholder-(\d+)-id/u)
      .map((component, idx) => {
        // The placeholder is always at odd indices
        if (idx % 2 === 0) {
          return replaceEndOfLine(component);
        }

        // The component will always be a number at odd index
        replaceCounter++;
        return expressionDocs[component];
      });
  });
  return expressionDocs.length === replaceCounter ? newDoc : null;
}
