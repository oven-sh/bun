runtimeAgent.getProperties(
  objectId,
  false, // ownProperties
  false, // accessorPropertiesOnly
  false, // generatePreview
  (error, properties, internalProperties) => {
    return 1
  },
);
