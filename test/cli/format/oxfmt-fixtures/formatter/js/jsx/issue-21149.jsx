// Punctuation after self-closing element — should soft break (collapse)
const PunctuationThenText = () => (
  <div>
    <Comp />
    , more text here
  </div>
);

// Single alphabetic char starting a text run — should hard break (preserve)
const App = () => (
  <div>
    I have a footnote.
    <FootnoteRef i18nKey="footnote1" />
    I have another footnote.
    <FootnoteRef i18nKey="footnote2" />
  </div>
);
