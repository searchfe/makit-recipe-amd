// @Author: qiansc
// @Date: 2019-04-28 14:43:21
// @Last Modified by: qiansc
// @Last Modified time: 2019-11-28 15:47:41
import {existsSync} from 'fs';
import {File} from 'gulp-util';
import {basename, dirname, extname, resolve} from 'path';
import {parseScript} from 'esprima';
import {include} from './filter';
import {parseAbsolute, parseBase, aliasConf} from './moduleID';
import md5File from 'md5-file';

interface ParseOptions {
    baseUrl: string,
    prefix: string,
    alias?: aliasConf[],
    staticBaseUrl?: string
    removeModuleId?: boolean | ((filePath: string) => boolean);
    useMd5?: any;
}

export interface Replacement {
    /** 原 contents 中的起始位置和结束位置 */
    range: [number, number];
    /** 替换后的内容 */
    value: string;
    /** 作废 */
    cancelled?: boolean;
}

export class Parser {
    private readonly baseUrl: string;
    private readonly prefix: string;
    private readonly alias?: aliasConf[];
    private readonly staticBaseUrl?: string;
    private readonly removeModuleId: (filePath: string) => boolean;
    private readonly useMd5: boolean = false;
    /** 要被排除的文件 */
    private readonly md5Exclude?: string[];
    /**
     * 以下属性每次 parse 都会重置
     */
    private filePath: string;
    /** 根据 filePath 计算出的 md5 */
    private md5Value: string;
    /** parse 时的 cwd，为 filePath 的目录 */
    private cwd: string;
    /** 临时存放要被替换的内容 */
    private replacements: Replacement[];
    /** 暂存 require nodes，当处理到 define 时判断是否属于 define 内部，如果属于则出列 */
    private deps: any[];
    /** 暂存 define nodes，出现嵌套 define 时作废内部 define */
    private defineNodes = [] as any[];

    constructor(options: ParseOptions) {
        this.baseUrl = options.baseUrl;
        this.prefix = options.prefix;
        this.alias = options.alias;
        this.staticBaseUrl = options.staticBaseUrl;
        if (typeof options.removeModuleId === 'function') {
            this.removeModuleId = options.removeModuleId;
        }
        else {
            this.removeModuleId = () => !!options.removeModuleId;
        }
        if (typeof options.useMd5 === 'object') {
            this.useMd5 = !!options.useMd5.useMd5;
            // 历史遗留的拼写错误 exlude -> exclude
            this.md5Exclude = options.useMd5.exlude;
        }
        else if (options.useMd5 === true) {
            this.useMd5 = true;
        }
    }

    public parse(file: File) {
        const contents = file.contents.toString();
        const filePath = this.filePath = file.path;
        /** 生成的ModuleId md5后缀来避免其他模块引用 @molecule/toptip2_134dfas */
        this.md5Value = this.getMd5(filePath);
        // reset
        this.cwd = dirname(filePath);
        this.replacements = [];
        this.deps = [];
        this.defineNodes = [];
        // parse
        parseScript(contents, {range: true}, (node: any) => {
            // e.g. require(['./foo', './bar'])
            if (isRequireCallArray(node)) {
                // 只替换，不添加到 deps
                node.arguments[0].elements.map(element => {
                    if (element.value && element.value.match(/^\.\.?\//) !== null) {
                        const moduleId = parseBase(
                            this.baseUrl,
                            parseAbsolute(this.cwd, element.value),
                            this.prefix,
                            this.alias);
                        this.replaceLiteralNode(element, moduleId);
                    }
                });
            }
            else if (isRequireCallLiteral(node)) {
                this.parseRequireCall(node);
            }
            else if (isDefineCall(node)) {
                // 作废嵌套 define 的改动
                this.cancelReplacementsFromDefineInsideNode(node);

                // 筛选在 define 内部的 require
                const deps = this.popDepsInsideNode(node);

                // parse 前记录改动起始 index
                const replacementIndexStart = this.replacements.length;
                this.parseDefineCall(node, deps);
                // parse 后记录改动终止 index
                const replacementIndexEnd = this.replacements.length;

                this.defineNodes.push({
                    range: node.range,
                    replacementIndexRange: [replacementIndexStart, replacementIndexEnd]
                });
            }
        });
        return replace(contents, this.replacements.filter(v => !v.cancelled));
    }

    private cancelReplacementsFromDefineInsideNode(node: any) {
        if (this.defineNodes.length < 1) {
            return;
        }
        let nextIndex = 0;
        while (nextIndex < this.defineNodes.length) {
            const defineNode = this.defineNodes[nextIndex];
            if (defineNode.range[0] > node.range[0]
                && defineNode.range[1] < node.range[1]) {
                // 属于 node 内部
                let i = defineNode.replacementIndexRange[0];
                while (i < defineNode.replacementIndexRange[1]) {
                    this.replacements[i++].cancelled = true;
                }
                // 出列
                this.defineNodes.splice(nextIndex, 1);
            }
            else {
                nextIndex++;
            }
        }
    }

    private getMd5(filePath) {
        if (!this.useMd5) {
            return '';
        }

        if (!include(resolve(filePath), this.md5Exclude, this.baseUrl)) {
            // 不在md5排除名单中
            try {
                return '_' + md5File.sync(filePath.replace('.js', '.ts')).slice(0, 7);
            }
            catch (e) {
                console.log(e);
            }
        }

        return '';
    }

    private parseDefineCall(node: any, deps: any[]) {
        this.parseDefineModuleId(node);
        if (node.arguments[1].elements
            // 至少数组中有一个元素才能定位插入位置
            && node.arguments[1].elements.length > 0) {
            const depMap = {};
            // 处理已声明的依赖
            node.arguments[1].elements.forEach(item => {
                let moduleId: string;
                /** depPath: 实际依赖的相对路径文件。如果是node_module就为空 */
                const depPath = parseAbsolute(dirname(this.filePath), item.value + '.ts');
                if (existsSync(depPath)) {
                    // moduleId 示例：@molecule/toptip/main_dc85e717d6352fa285bc70bc2d1d3595
                    moduleId = parseBase(this.baseUrl, depPath, this.prefix, this.alias) + this.md5Value;
                }
                else {
                    const prefix = item.value.match(/^\./) === null ? '' : this.prefix;
                    const baseUrl = extname(item.value) !== '.json' ? (this.baseUrl || this.cwd)
                        : (this.staticBaseUrl || this.baseUrl || this.cwd);
                    moduleId = parseBase(
                        baseUrl,
                        parseAbsolute(this.cwd, item.value),
                        prefix, this.alias);
                }
                this.replaceLiteralNode(item, moduleId);
                depMap[moduleId] = true;
            });
            // 添加依赖 require
            if (!node.arguments[1].elements.some(item => item.value === 'require')) {
                this.insertBefore(node.arguments[1].elements[0], '"require", ');
                // 同时给入参添加 require
                if (node.arguments[2] && node.arguments[2].params) {
                    this.insertBefore(node.arguments[2].params[0], 'require, ');
                }
            }
            // 添加内部 require(...) 的依赖
            const lastElement = node.arguments[1].elements[node.arguments[1].elements.length - 1];
            const appendDepsRawValue = deps.filter(dep => {
                if (depMap[dep.value]) {
                    return false;
                }
                // 防止多次 require 重复添加相同的依赖
                depMap[dep.value] = true;
                return true;
            }).map(v => `, "${v.value}"`).join('');
            this.insertAfter(lastElement, appendDepsRawValue);
        }
        else {
            let insertIndex;
            if (node.arguments[1].elements) {
                // 有依赖数组但是为空
                if (node.arguments[2]) {
                    this.replacements.push({
                        range: [
                            node.arguments[1].range[0],
                            node.arguments[2].range[0]
                        ],
                        value: ''
                    });
                }
                else {
                    this.removeNode(node.arguments[1]);
                }
                insertIndex = node.arguments[1].range[0];
            }
            else {
                // 插入占位
                node.arguments.splice(1, 0, {
                    elements: []
                });
                insertIndex = node.arguments[2].range[0];
            }
            // 从第三参数函数的入参补充第二参数依赖数组
            const prependDeps = [];
            let hasRequire = false;
            const hasParams = !!(node.arguments[2] && node.arguments[2].params);
            if (hasParams) {
                node.arguments[2].params.forEach(item => {
                    if (item.name === 'require') {
                        prependDeps.push('require');
                        hasRequire = true;
                    }
                    else if (item.name === 'exports') {
                        prependDeps.push('exports');
                    }
                    else if (item.name === 'module') {
                        prependDeps.push('module');
                    }
                });
            }
            // 补充 require
            if (!hasRequire) {
                prependDeps.unshift('require');
                // 给 params 添加 require
                if (hasParams) {
                    if (node.arguments[2].params.length) {
                        // 如果有 params，在第一个参数前插入
                        this.insertBefore(node.arguments[2].params[0], 'require, ');
                    }
                    else {
                        let replaceIndexStart: number;
                        let value: string;
                        if (node.arguments[2].id) {
                            // id 的终止位置
                            replaceIndexStart = node.arguments[2].id.range[1];
                            value = ' (require) ';
                        }
                        else {
                            // 匿名函数
                            replaceIndexStart = node.range[0];
                            value = 'function (require) ';
                        }
                        // body 的起始位置
                        const replaceIndexEnd = node.arguments[2].body.range[0];
                        this.replacements.push({
                            range: [replaceIndexStart, replaceIndexEnd],
                            value
                        });
                    }
                }
            }
            const depMap = {};
            const appendDeps = deps.filter(dep => {
                if (depMap[dep.value]) {
                    return false;
                }
                depMap[dep.value] = true;
                return true;
            });
            const insertValue = JSON.stringify([...prependDeps, ...appendDeps.map(v => v.value)]) + ', ';
            this.replacements.push({
                range: [insertIndex, insertIndex],
                value: insertValue
            });
        }
    }

    private parseDefineModuleId(node: any) {
        const removeModuleId = this.removeModuleId(this.filePath);
        if (node.arguments[0].type === 'Literal') {
            // 移除 moduleId
            if (removeModuleId) {
                if (node.arguments[1]) {
                    this.replacements.push({
                        range: [
                            node.arguments[0].range[0],
                            node.arguments[1].range[0]
                        ],
                        value: ''
                    });
                }
                else {
                    this.removeNode(node.arguments[0]);
                }
                return;
            }
            // 修改 moduleId
            const value = node.arguments[0].value as string;
            if (value.split('/').pop() === basename(this.filePath, extname(this.filePath))) {
                const prefix = value.match(/^\./) === null ? '' : this.prefix;
                const moduleId = parseBase(this.baseUrl, this.filePath, prefix, this.alias);
                this.replaceLiteralNode(node.arguments[0], moduleId);
            }
            return;
        }
        // 插入占位
        node.arguments.unshift({});
        if (removeModuleId) {
            // 无需新增
            return;
        }
        // 添加 moduleId
        const moduleId = parseBase(this.baseUrl, this.filePath, this.prefix, this.alias) + this.md5Value;
        this.insertBefore(node.arguments[1], `"${moduleId}", `);
    }

    private parseRequireCall(node: any) {
        let value = node.init ? node.init.arguments[0].value : node.arguments[0].value;
        const prefix = value.match(/^\./) === null ? '' : this.prefix;
        const baseUrl = extname(value) !== '.json' ? (this.baseUrl || this.cwd)
            : (this.staticBaseUrl || this.baseUrl || this.cwd);
        const moduleId = parseBase(
            baseUrl,
            parseAbsolute(this.cwd, value),
            prefix,
            this.alias
        );
        if (node.arguments
            && node.arguments[0]
            && node.arguments[0].value
            && node.arguments[0].value.match(/^\./) !== null) {
            this.replaceLiteralNode(node.arguments[0], moduleId);
            this.deps.push({
                range: node.arguments[0].range,
                value: moduleId
            });
        }
        else {
            this.deps.push({
                range: node.arguments[0].range,
                value
            });
        }
    }

    private popDepsInsideNode(node: any) {
        const deps = [];
        if (this.deps.length > 0) {
            let nextIndex = 0;
            while (nextIndex < this.deps.length) {
                const dep = this.deps[nextIndex];
                if (dep.range[0] > node.range[0]
                    && dep.range[1] < node.range[1]) {
                    // 属于 node 内部，加入依赖
                    deps.push(dep);
                    // 出列
                    this.deps.splice(nextIndex, 1);
                }
                else {
                    nextIndex++;
                }
            }
        }
        return deps;
    }

    private replaceLiteralNode(node: any, value: string) {
        if (node.value === value) {
            return;
        }
        this.replacements.push({
            range: node.range,
            value: `"${value}"`
        });
    }

    private removeNode(node: any) {
        this.replacements.push({
            range: node.range,
            value: ''
        });
    }

    private insertBefore(node: any, rawValue: string) {
        const insertIndex = node.range[0];
        this.replacements.push({
            range: [insertIndex, insertIndex],
            value: rawValue
        });
    }

    private insertAfter(node: any, rawValue: string) {
        const insertIndex = node.range[1];
        this.replacements.push({
            range: [insertIndex, insertIndex],
            value: rawValue
        });
    }
}

function replace(contents: string, replacements: Replacement[]) {
    const results = [] as string[];
    // 替换后的起始位置
    let index = 0;
    replacements
        .sort((a, b) => {
            // 按终止位置升序
            return a.range[1] - b.range[1];
        })
        .forEach(v => {
            const {range: [start, end], value} = v;
            // 先添加从上一次替换后的起始位置到本次替换位置前的内容
            results.push(contents.slice(index, start));
            // 添加替换的内容
            results.push(value);
            // 修改下一次的起始位置
            index = end;
        });
    // 添加最后的内容
    results.push(contents.slice(index));
    return results.join('');
}

/**
 * node 是 define(...)
 */
function isDefineCall(node: any) {
    return node.type === 'CallExpression'
        && node.callee
        && node.callee.name === 'define';
}

function isRequireCall(node: any, firstArgType?: string) {
    return node.type === 'CallExpression'
        && node.callee
        && node.callee.name === 'require'
        && node.arguments[0]
        && (firstArgType ? node.arguments[0].type === firstArgType : true);
}

/**
 * 例 require('./foo');
 */
function isRequireCallLiteral(node: any) {
    return isRequireCall(node, 'Literal');
}

/**
 * 例子 require(['./foo'])
 */
function isRequireCallArray(node: any) {
    return isRequireCall(node, 'ArrayExpression');
}
