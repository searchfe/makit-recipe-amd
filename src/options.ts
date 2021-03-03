import {include} from './utils/filter';
import {resolve} from 'path';

export function normalize(options: AmdNormalizeOptions) {
    const alias: aliasConf[] = [];
    const projectRoot = options.projectRoot || options.baseUrl || process.cwd();
    if (options.alias) {
        options.alias.forEach(a => {
            alias.push({
                'moduleId': a.moduleId,
                'path': resolve(projectRoot, a.path),
                'prefix': a.prefix || false});
        });
    }
    // 传入baseUrl则moduleid基于baseUrl计算
    let baseUrl;
    let staticBaseUrl = options.staticBaseUrl;
    if (options.baseUrl) {
        baseUrl = options.baseUrl;
        if (options.projectRoot) {
            baseUrl = resolve(options.projectRoot, baseUrl);
        }
    }
    if (staticBaseUrl && options.projectRoot) {
        staticBaseUrl = resolve(options.projectRoot, staticBaseUrl);
    }
    const prefix = options.prefix || '';
    const removeModuleId = (filePath: string) => include(filePath, options.anonymousModule, baseUrl);

    let useMd5 = false;
    let md5Exclude = [];
    if (typeof options.useMd5 === 'object') {
        useMd5 = !!options.useMd5.useMd5;
        // 历史遗留的拼写错误 exlude -> exclude
        md5Exclude = options.useMd5.exlude;
    }
    else if (options.useMd5 === true) {
        useMd5 = true;
    }

    return {
        projectRoot,
        baseUrl,
        alias,
        exclude: options.exclude || [],
        staticBaseUrl,
        prefix,
        useMd5,
        md5Exclude,
        removeModuleId
    };
}

export interface AmdNormalizeOptions {
    /** 即项目根目录。用来配置模块查找根目录（相对 projectRoot 的路径） */
    baseUrl?: string;
    /** moduleID前缀 */
    prefix?: string;
    cwd?: string;
    /** 不参与解析与调整的模块（相对 baseUrl 的路径） */
    exclude?: string[];
    /** 不参与解析，只快速调整的模块 */
    exludeAnalyze?: string[];
    /** 自定义moduleID模块 */
    alias?: aliasConf[]
    moduleId?: string;
    /** 不参与生成moduleId的模块 */
    anonymousModule?: string[];
    /** 配置文件路径 */
    /** 静态资源的根目录 */
    staticBaseUrl?: string;
    /** 生成的ModuleId 是否需要md5后缀来避免其他模块引用 如 @molecule/toptip2_134dfas */
    useMd5?: any;
    /** 工程目录 */
    projectRoot?: string
}

export interface aliasConf {
    /** 自定义moduleID */
    moduleId: string;
    /** 自定义module path。相对 projectRoot 的路径 */
    path: string;
    /** 带上别名 */
    prefix?: boolean;
}
