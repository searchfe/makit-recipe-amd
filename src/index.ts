
import {Context} from 'makit';
import {extname} from 'path';
import {include} from './utils/filter';
import {parse} from './parse';
import {normalize as normalizeOptions, AmdNormalizeOptions} from './options';

export {aliasConf} from './options';

export function normalize(options: AmdNormalizeOptions) {
    const normalizedOptions = normalizeOptions(options);
    const {baseUrl, exclude} = normalizedOptions;

    return (ctx: Context) => {
        function done(result: string) {
            ctx.writeTargetSync(result);
        }

        const filePath = ctx.dependencyPath();
        let contents = ctx.readDependencySync();

        if (extname(filePath) !== '.js') {
            return done(contents);
        }

        if (include(filePath, exclude, baseUrl)) {
            return done(contents);
        }

        try {
            contents = parse(contents.toString(), {
                ...normalizedOptions,
                filePath
            });
        }
        catch (e) {
            ctx.logger.warning('AMD', `${filePath} compile error \n  |__${e.message}`);
        }

        done(contents);
    };
};
