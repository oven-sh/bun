const extraRendererAttrs = ((attrs.rendererAttrs &&
  this.utils.safeParseJsonString(attrs.rendererAttrs)) ||
  Object.create(null)) satisfies FieldService.RendererAttributes;

const annotate = (angular.injector satisfies any).$$annotate satisfies (
  fn: Function
) => string[];
  
const originalPrototype = originalConstructor.prototype satisfies TComponent & InjectionTarget,
  propertyToServiceName = originalPrototype._inject;

this.previewPlayerHandle = (setInterval(async () => {
  if (this.previewIsPlaying) {
    await this.fetchNextPreviews();
    this.currentPreviewIndex++;
  }
}, this.refreshDelay) satisfies unknown) satisfies number;

this.intervalID = (setInterval(() => {
  self.step();
}, 30) satisfies unknown) satisfies number;
