const defaultMaskGetter = $parse(attrs[directiveName]) as (
  scope: ng.IScope
) => Mask;

(this.configuration as any) = (this.editor as any) = (this
  .editorBody as any) = undefined;

angular.module("foo").directive("formIsolator", () => {
  return {
    name: "form",
    controller: class FormIsolatorController {
      $addControl = angular.noop;
    } as ng.IControllerConstructor,
  };
});

(this.selectorElem as any) = this.multiselectWidget = this.initialValues = undefined;

const extraRendererAttrs = ((attrs.rendererAttrs &&
  this.utils.safeParseJsonString(attrs.rendererAttrs)) ||
  Object.create(null)) as FieldService.RendererAttributes;

const annotate = (angular.injector as any).$$annotate as (
  fn: Function
) => string[];

const originalPrototype = originalConstructor.prototype as TComponent & InjectionTarget,
  propertyToServiceName = originalPrototype._inject;
