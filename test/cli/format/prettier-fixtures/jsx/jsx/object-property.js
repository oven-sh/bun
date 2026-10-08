const tabs = [
  {
    title: "General Info",
    content: (
      <GeneralForm
        long-attribute="i-need-long-value-here"
        onSave={ onSave }
        onCancel={ onCancel }
        countries={ countries }
      />
    )
  }
];
