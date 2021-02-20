# makit-recipe-amd

处理 AMD 模块源文件

- 根据文件路径和配置，对匿名 `define` 的模块进行重命名
- 依赖分析，将模块内部 `require` 的模块提取成外层模块依赖数组，并转换模块名

## Install

```
npm install --save-dev makit-recipe-amd
```

## Usage

```js
import { recipeFactory } from 'makit-plugin/utils/recipe-factory';
import { wrap } from 'makit-recipe-amd';

rule('foo.js.wrap', 'foo.js', recipeFactory(wrap, {base: 'path/to/repo', alias: []}, [{
    file: 'src/**.js',
    baseUrl: 'src'
}]));
```

## Example

假设你代码库的目录如下

```
repo/src
├── bar.js
└── foo.js
```

```js
// repo/src/foo.js
define(function () {
    var dep = require('./bar');
    console.log(dep);
});
```

假设配置如下

```js
rule('dist/foo.js.wrap', 'src/foo.js', recipeFactory(wrap, {}, [{
    file: 'src/**.js',
    baseUrl: 'src',
    prefix: '@my-module'
}]));
```

经过 `wrap` 处理后得到的产物如下

```js
// repo/dist/foo.js.wrap
define('@my-module/foo', ['require', '@my-module/bar'], function(require, bar) {
    var dep = require('@my-module/bar');
    console.log(dep);
});
```