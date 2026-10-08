const getAccountCount = async () =>
  (await
    ((await (
      await focusOnSection(BOOKMARKED_PROJECTS_SECTION_NAME)
    ).findItem("My bookmarks")) as TreeItem
  ).getChildren()
  ).length
