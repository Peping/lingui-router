const t = require('@babel/types');
const {parse} = require('path-to-regexp');
const linguiConfig = require('@lingui/conf');
const glob = require('glob-promise');
const path = require('path');
const fs = require('fs/promises');

const ExtractVisitor = {
  Program: {
    enter(_, state) {
      state.opts.moduleName = state.opts.moduleName || 'lingui-router';
      state.imports = {};
      state.parseCache = {};
      state.catalogStrings = new Set();
    },
    async exit(_, state) {
      const localeDirs = await glob(path.join(linguiConfig.getConfig().localeDir));
      for (let dir of localeDirs) {
        const routeCatalogFilename = path.join(dir, 'routes.json');
        const routeCatalog = (await fs.access(routeCatalogFilename))
          ? JSON.parse(await fs.readFile(routeCatalogFilename).toString())
          : {}
        ;

        for (let key of state.catalogStrings.values()) {
          if (!(key in routeCatalog)) {
            routeCatalog[key] = key;
          }
        }

        await fs.writeFile(JSON.stringify(routeCatalog, null, 2));
      }
    }
  },

  ImportDeclaration: {
    enter(path, state) {
      if (t.isStringLiteral(path.node.source) && path.node.source.value === state.opts.moduleName) {
        for (let name of ['Route']) {
          const specifier = path.node.specifiers.find((s) => s.imported && s.imported.name === name);

          if (specifier) {
            state.imports[name] = specifier.local.name;
          }
        }
      }
    }
  },

  JSXOpeningElement(path, state) {
    if (!process.env.LINGUI_EXTRACT) {
      return;
    }

    const identifier = path.node.name;

    if (state.imports['Route'] && identifier.name === state.imports['Route']) {
      // find path attribute, else bail
      const pathAttribute = path.node.attributes.find(attr => attr.name.name === 'path');

      if (!pathAttribute) {
        return;
      }

      // ensure path attribute is string literal or template literal with only one quasi
      let catalogString;
      if (t.isStringLiteral(pathAttribute.value)) {
        catalogString = pathAttribute.value.value;
      }

      if (t.isJSXExpressionContainer(pathAttribute.value)) {
        const expression = pathAttribute.value.expression;
        if (t.isStringLiteral(expression)) {
          catalogString = expression.value;
        } else if (t.isTemplateLiteral(expression) && expression.expressions.length === 0) {
          catalogString = expression.quasis[0].value.cooked;
        }
      }

      if (!catalogString) {
        throw path.buildCodeFrameError('Route only accepts simple string literals in its path');
      }

      // add route to catalog
      state.catalogStrings.add(catalogString);
    }
  }
};

module.exports = () => ({
  visitor: ExtractVisitor
});
