const path = require("path");
const fs = require("fs");

const config = require("./config");
const logger = require("./log");
const postload_tasks = [];
const languages = {};
const file_handlers = new Map();
const PROJECT_PATH = path.resolve(process.cwd(), ".mcproject", "PROJECT.json");
const os = require("os");
  const LOCAL_PATH = os.platform().startsWith("win")?path.resolve(
    process.env.APPDATA,
    "mc-build",
    "local"
  ):path.resolve(
    os.homedir(),
    ".mc-build",
    "local"
  );
let transformers = {};

let potentialLanguages = [];
function loadLanguageFromPath(lang, location) {
  if (!languages[lang]) {
    languages[lang] = require(path.join(location, "/entry.js"))(
      file_handlers
    ).exported;
  }
}
function loadLanguageConfigFromPath(lang, location) {
  if (!languages[lang]) {
    config.addConfig(lang, require(path.join(location, "/config.js")));
  }
}
function loadLanguageTransformersFromPath(name, location) {
  const target = path.resolve(location, "transformlib.js");
  const meta = path.resolve(location, "lang.json");
  if (fs.existsSync(target)) {
    const transformlib = require(target);
    const langMeta = require(meta);
    if (typeof transformlib === "function") {
      langMeta.extensions.forEach((ext) => {
        transformers[ext] = transformlib;
      });
    } else if (transformers) {
      transformers = { ...transformers, ...transformlib };
    }
  } else {
    logger.warn(`found no transformers for ${name}`);
  }
}
function getName(name) {
  if (!name.startsWith("lang-") && !name.startsWith("lib-") ) {
    logger.error("malformed language name! expected 'lang-' or 'lib-'");
  }
  return name.replace(/^(lang-|lib-)/,"").split("/")[0];
}
function loadLanguages() {
  const project = require(PROJECT_PATH);
  const langs = project.languages;
  const loaded = new Set();
  langs.forEach((lang) => {
    if (lang.remote.type === "file") {
      const name = getName(lang.name);
      loadLanguageConfigFromPath(name, lang.remote.path);
    } else {
      const name = getName(lang.name);
      loadLanguageConfigFromPath(
        name,
        path.resolve(LOCAL_PATH, ".cache", "language", lang.name)
      );
    }
  });
  const loadLanguage = (lang) => {
    if (!loaded.has(lang)) {
      if (lang.load_after) {
        lang.load_after.forEach((name) =>
          loadLanguage(langs.find((l) => l.name.split("/")[0] === name))
        );
      }
      if (lang.remote.type === "file") {
        const name = getName(lang.name);
        loadLanguageFromPath(name, lang.remote.path);
      } else {
        const name = getName(lang.name);
        loadLanguageFromPath(
          name,
          path.resolve(LOCAL_PATH, ".cache", "language", lang.name)
        );
      }
      loaded.add(lang);
    }
  };
  langs.forEach(loadLanguage);
}

function loadTransformers() {
  const project = require(PROJECT_PATH);
  project.languages.forEach((lang) => {
    if (lang.remote.type === "file") {
      const name = getName(lang.name);
      loadLanguageTransformersFromPath(name, lang.remote.path);
    } else {
      const name = getName(lang.name);
      loadLanguageTransformersFromPath(
        name,
        path.resolve(LOCAL_PATH, ".cache", "language", lang.name)
      );
    }
  });
  return transformers;
}

module.exports = {
  postload_tasks,
  loadLanguageFromPath,
  loadLanguages,
  loadTransformers,
  languages,
  file_handlers,
  potentialLanguages,
};
