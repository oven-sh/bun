const handleFoo = useCallback((...args) => {
  onSubmit(...args);
  onClose();
}, [onSubmit, onClose]);
