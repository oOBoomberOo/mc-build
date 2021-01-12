const Module = require("module");
const path = require("path");

const logger = require("./log");
const loader = require("./load_language");

const modules = {};
const $require = Module.prototype.require;
const possibleModuleStarts = new Set();
function setModule(vloc, data, resolve, final) {
  possibleModuleStarts.add(vloc);
  modules[vloc] = { resolve, value: data, final };
}

function addModule(mod, vloc, resolve, final = false) {
  const loc = require.resolve(mod);
  const data = require(loc);
  setModule(vloc, data, resolve, final);
}

module.exports.addModule = addModule;

addModule("./io", "!io", (_) => _);
addModule("./pkg/package", "!package", (_) => _);
addModule("./config", "!config", (_) => _.config());
addModule("./persistent", "!persistent", (_) => _);
addModule("./log", "!logger", (_) => _);
addModule("./errors", "!errors", (_) => _);

function logPossible(k, o) {
  logger.error(k);
  if (typeof o === "object") {
    Object.entries(o).forEach(([name, val]) => {
      logPossible(k + "/" + name, val[name]);
    });
  }
}

Module.prototype.require = function (id) {
  const SKIP = id[0] === "^";
  if (SKIP) {
    return $require.apply(this, [id.substr(1)]);
  }
  const start = id.split("/")[0];
  if (possibleModuleStarts.has(start)) {
    try {
      const [base, ...rest] = id.split("/");
      if (base === "!lang") {
        const lang_ = rest[0];
        if (!modules[base + "/" + lang_]) {
          if (
            !loader.languages[lang_] &&
            loader.potentialLanguages.includes(lang_)
          ) {
            loader.loadLanguageFromPath(lang_, path.join(loader.target, lang_));
          }
        }
      }
      let value = modules[base].resolve(modules[base].value, id);
      if (modules[base].final) return value;
      if (rest.length) {
        let item = null;
        while ((item = rest.shift())) {
          value = value[item];
        }
      }
      return value;
    } catch (e) {
      logger.error(`failed to resolve module '${id}' (${e.message})`);
      logger.error(`-------------------[Virtual Modules]-------------------`);
      Object.entries(modules).forEach(([name, mod]) => {
        logPossible(name, mod.resolve(mod.value));
      });
      logger.error(`-------------------------------------------------------`);
      throw e;
    }
  } else {
    return $require.apply(this, [id]);
  }
};

addModule("./interface", "!mod", (_) => ({ add: addModule, set: setModule }));

if (process.argv.includes("-debug-interface")) {
  setTimeout(() => {
    Object.entries(modules).forEach(([name, mod]) => {
      logPossible(name, mod.resolve(mod.value));
    });
  }, 1000);
}
