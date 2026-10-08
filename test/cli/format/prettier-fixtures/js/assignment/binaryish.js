const computedDescriptionLines = (showConfirm &&
  descriptionLinesConfirming) ||
  (focused && !loading && descriptionLinesFocused) ||
  descriptionLines;

computedDescriptionLines = (focused &&
  !loading &&
  descriptionLinesFocused) ||
  descriptionLines;
