export default class AddAssetHtmlPlugin {
  apply(compiler: WebpackCompilerType) {
    compiler.plugin('compilation', (compilation: WebpackCompilationType) => {
      compilation.plugin('html-webpack-plugin-before-html', (callback: Callback<any>) => {
        addAllAssetsToCompilation(this.assets, compilation, htmlPluginData, callback);
      });
    });
  }
}
