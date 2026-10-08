function StatelessFunctionalComponent({
  isActive,
  onFiltersUpdated,
  onSelect,
  onSubmitAndDeselect,
  onCancel,
  searchFilters,
  title,
  items,
}) {
  return <div />
}

function StatelessFunctionalComponent2({
  isActive = true,
  onFiltersUpdated = () => null,
  onSelect = () => null,
  onSubmitAndDeselect = () => null,
  onCancel = () => null,
  searchFilters = null,
  title = '',
  items = [],
} = {}) {
  return <div />
}

function StatelessFunctionalComponent3(
  {
    isActive,
    onFiltersUpdated = () => null,
    onSelect = () => null,
    onSubmitAndDeselect = () => null,
    onCancel = () => null,
    searchFilters = null,
    title = '',
    items = [],
  } = {
    isActive: true
  }
) {
  return <div />
}


class C {
  StatelessFunctionalComponent({
    isActive,
    onFiltersUpdated,
    onSelect,
    onSubmitAndDeselect,
    onCancel,
    searchFilters,
    title,
    items,
  }) {
    return <div />
  }
}
