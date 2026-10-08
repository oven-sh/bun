{
  {
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
      ...args
    ) {
      return {
        ...originalGetBoundingClientRect.bind(this)(...args),
        top: canvasTop,
        left: canvasLeft,
        width: canvasWidth,
        height: canvasHeight,
      };
    });
  }
}
