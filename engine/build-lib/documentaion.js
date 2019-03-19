const utils = require('./utils');
const consts = require('./consts');
const translation = require('./translation');
const fs = require('fs');
const path = require('path');

const IGNORE = ['/adapterref'];

// possible inputs:
// [en:Bascis;de:Einleitung;ru:Основы](basics/README)
// de:Grundlagen;en:Fundamentals
// Title
async function translateTitle(title) {
    const words = {};
    title = title.trim();
    if (title.startsWith('[')) {
        const m = title.match(/\[(.+)]\((.*)\)/);
        title = m[1];
        words.link = m[2].trim();
        if (words.link.indexOf('.') === -1) {
            words.link += '.md';
        }
        /*if (!words.link.startsWith('/')) {
            words.link = '/' + words.link;
        }*/
    }
    const langs = title.split(';');
    langs.forEach(lang => {
        const parts = lang.split(':');
        if (parts.length === 2) {
            words[parts[0].trim()] = parts[1].trim();
        } else {
            words.en = lang.trim();
        }
    });
    consts.LANGUAGES.forEach(lang => {
        if (!words[lang]) {
            words[lang] = (words.en || words.de);
            if (words[lang][2] !== '!') {
                words[lang] = lang + '!' + words[lang];
            }
        }
    });
    // read title from file
    if (words.link) {
        consts.LANGUAGES.forEach(lang => {
            const name = path.join(consts.SRC_DOC_DIR, lang, words.link);
            if (fs.existsSync(name)) {
                const data = fs.readFileSync(name).toString('utf-8');
                const title = utils.getTitle(data);
                if (title) {
                    words[lang] = title;
                }
            }
        });
    }


    return words;
}

async function processContent(filePath) {
    const lines = fs.readFileSync(filePath).toString().replace(/\r/g, '').split('\n');
    const content = {pages: {}};
    const levels = [content, null, null, null];
    return new Promise(resolve => {
        return Promise.all(lines.map(async line => {
            const pos = line.indexOf('*');
            if (pos !== -1) {
                const level = pos / 2;
                const words = await translateTitle(line.substring(pos + 1));
                const link = words.link;
                if (link) {
                    delete words.link;
                }
                const obj = {
                    title: words
                };
                if (link) {
                    obj.content = link;
                }
                levels[level].pages = levels[level].pages || {};
                levels[level].pages[words.en] = obj;
                levels[level + 1] = obj;
            }
        })).then(result => {
            const name = filePath.replace(/\\/g, '/').split('/').pop().replace(/\.md$/, '.json');
            fs.writeFileSync(consts.FRONT_END_DIR + name, JSON.stringify(content, null, 2));
            resolve(content);
        });
    });
}

// read file and copy it in the front-end directory
async function processFile(fileName, lang, root) {
    root     = root.replace(/\\/g, '/');
    fileName = fileName.replace(/\\/g, '/');

    let data = fs.readFileSync(fileName);
    if (fileName.match(/\.md$/)) {
        let {header, body} = utils.extractHeader(data.toString());
        header.editLink = consts.GITHUB_EDIT_ROOT + 'docs/' + fileName.replace(root, '');
        data = utils.addHeader(body, header);
    }
    utils.writeSafe(path.join(consts.FRONT_END_DIR, fileName.replace(root, '/')).replace(/\\/g, '/'), data);

    return Promise.all(consts.LANGUAGES.filter(ln => ln !== lang).map(ln => {
        const name = fileName.replace('/' + lang + '/', '/' + ln + '/');

        if (!fs.existsSync(name)) {
            if (name.match(/\.md$/)) {
                // create automatic translation
                const langName = path.join(consts.FRONT_END_DIR, name.replace(root, '/')).replace(/\\/g, '/');
                if (!fs.existsSync(langName)) {
                    return translation.translateFile(fileName, data.toString('utf-8'), lang, ln, root)
                        .then(text => {
                            utils.writeSafe(path.join(consts.FRONT_END_DIR, name.replace(root, '/')), text);
                        });
                } else {
                    return Promise.resolve();
                }
            } else {
                console.log(`ERROR: File ${fileName.replace(root, '/')} cannot be translated from ${lang} to ${ln} automatically!`);
                utils.writeSafe(path.join(consts.FRONT_END_DIR, name.replace(root, '/')).replace(/\\/g, '/'), data);
            }
        } else {
            // the file will be copied later
            return Promise.resolve();
        }
    }));
}

// process all files in directory recursively
async function processFiles(root, lang, originalRoot) {
    root = root.replace(/\\/g, '/');
    if (!lang) {
        return Promise.all(consts.LANGUAGES.map(lang =>
            processFiles(path.join(root, lang).replace(/\\/g, '/'), lang, root)));
    } else {
        const promises = fs.readdirSync(root).filter(name => !name.startsWith('_')).map(name => {
            const fileName = path.join(root, name).replace(/\\/g, '/');
            const stat = fs.statSync(fileName);
            if (stat.isDirectory()) {
                if (IGNORE.indexOf(fileName.replace(root, '')) === -1) {
                    return processFiles(fileName, lang, originalRoot);
                } else {
                    return Promise.resolve();
                }
            } else {
                return processFile(fileName, lang, originalRoot);
            }
        });
        return Promise.all(promises);
    }
}

if (!module.parent) {
    processContent(path.join(consts.SRC_DOC_DIR, 'content.md')).then(content => {
        console.log(JSON.stringify(content));
        return processFiles(consts.SRC_DOC_DIR);
    });
} else {
    module.exports = {
        processContent,
        processFiles
    };
}
