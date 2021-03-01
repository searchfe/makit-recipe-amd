/* eslint-disable max-lines-per-function */
import {File} from 'gulp-util';
import {Parser} from '../src/wrap/parser';

describe('Test Parser', () => {
    it('should emit moduleId', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(function () {});
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define("@my-module/foo", ["require"], function (require) {});
            `);
    });

    it('should not emit moduleId', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix, removeModuleId: true});
        const file = {
            contents: `
            define(function () {});
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define(["require"], function (require) {});
            `);
    });

    it('should remove moduleId', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix, removeModuleId: true});
        const file = {
            contents: `
            define('foo', [], function () {});
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define(["require"], function (require) {});
            `);
    });

    it('should parse require literal', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(function () {
                var bar = require('./bar.js');
                var bar2 = require('./bar.js');
                var baz = require('./baz.js');
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        // 多次 require 同一模块只会添加一次
        expect(result).toBe(`
            define("@my-module/foo", ["require","@my-module/bar","@my-module/baz"], function (require) {
                var bar = require("@my-module/bar");
                var bar2 = require("@my-module/bar");
                var baz = require("@my-module/baz");
            });
            `);
    });

    it('should parse require arrays', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(function () {
                var bar = require('./bar.js');
            });
            require(['./foo.js']);
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define("@my-module/foo", ["require","@my-module/bar"], function (require) {
                var bar = require("@my-module/bar");
            });
            require(["@my-module/foo"]);
            `);
    });

    it('should rewrite dependencies array', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define([], function () {
                var bar = require('./bar.js');
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define("@my-module/foo", ["require","@my-module/bar"], function (require) {
                var bar = require("@my-module/bar");
            });
            `);
    });

    it('should emit alias', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const alias = [{
            moduleId: '@alias/foo',
            path: `${baseUrl}/bar.js`,
            prefix: false
        }];
        const parser = new Parser({baseUrl, prefix, alias});
        const file = {
            contents: `
            define([], function () {
                var bar = require('./bar.js');
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define("@my-module/foo", ["require","@alias/foo"], function (require) {
                var bar = require("@alias/foo");
            });
            `);
    });

    it('should emit dependencies array from params', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(function (module) {
                module.exports = {};
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        expect(result).toBe(`
            define("@my-module/foo", ["require","module"], function (require, module) {
                module.exports = {};
            });
            `);
    });

    it('should prepend require to dependencies array', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(['./bar.js', './baz.js'], function (bar, baz) {
                var bar2 = require('./bar.js');
                var log = require('./log.js');
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        // 已在依赖数组中声明的模块，内部再次 require 时不会重复添加
        expect(result).toBe(`
            define("@my-module/foo", ["require", "@my-module/bar", "@my-module/baz", "@my-module/log"], function (require, bar, baz) {
                var bar2 = require("@my-module/bar");
                var log = require("@my-module/log");
            });
            `);
    });

    it('should not modify inner define', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(function () {
                var bar = require('./bar.js');
                define(function () {
                    var baz = require('./baz.js');
                });
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        // 嵌套 define 里的 require 不会提升到顶层 define 的依赖数组中
        expect(result).toBe(`
            define("@my-module/foo", ["require","@my-module/bar"], function (require) {
                var bar = require("@my-module/bar");
                define(function () {
                    var baz = require("@my-module/baz");
                });
            });
            `);
    });

    it('should keep named function', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(function foo () {
                var bar = require('./bar.js');
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        // 嵌套 define 里的 require 不会提升到顶层 define 的依赖数组中
        expect(result).toBe(`
            define("@my-module/foo", ["require","@my-module/bar"], function foo (require) {
                var bar = require("@my-module/bar");
            });
            `);
    });

    it('should convert arrow function to anonymous function', () => {
        const baseUrl = '/path/to/repo';
        const prefix = '@my-module';
        const parser = new Parser({baseUrl, prefix});
        const file = {
            contents: `
            define(() => {
                var bar = require('./bar.js');
            });
            `,
            path: `${baseUrl}/foo.js`
        } as unknown as File;
        const result = parser.parse(file);
        // 嵌套 define 里的 require 不会提升到顶层 define 的依赖数组中
        expect(result).toBe(`
            define("@my-module/foo", ["require","@my-module/bar"], function (require) {
                var bar = require("@my-module/bar");
            });
            `);
    });
});
