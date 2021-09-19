const { readdirSync } = require("fs");
const fetch = require("node-fetch");
const prompt = require("prompts");
const logger = require("./log");
const path = require("path");
const fs = require("fs");
const { fork } = require("child_process");
module.exports = async function () {
  const isInDatapacks =
    process.cwd().endsWith(`datapacks`) &&
    path.resolve(process.cwd(), "..", "..").endsWith(`saves`);
  if (!isInDatapacks && readdirSync(process.cwd()).length) {
    logger.error(
      "unable to run bootstrap as there is already something in the directory."
    );
    return;
  }
  const manifest = await fetch("http://api.mcbuild.dev/catalog").then((res) =>
    res.json()
  );
  const initial_options = await prompt([
    {
      type: () => (isInDatapacks ? "text" : false),
      message: "Whats your Data pack's name?",
      format(value) {
        if (value === "") return "Unnamed Data pack";
        return value;
      },
      name: "datapack_name",
    },
    {
      type: "number",
      message: "Whats your Data pack's pack format?",
      initial: 8,
      name: "datapack_version",
    },
    {
      type: "text",
      message: "Whats your Data pack's description?",
      format(value) {
        if (value === "") return "An unnamed Data pack";
        return value;
      },
      name: "datapack_description",
    },
    {
      type: "autocompleteMultiselect",
      name: "languages",
      message: "What languages do you want to use?",
      hint: "  (select at least one)",
      choices: manifest.langs.map((language) => ({
        title: language,
        value: language,
      })),
      min: 1,
    },
    {
      type: "toggle",
      name: "add_lib",
      message: "would you like to add any libraries?",
      initial: false,
      active: "yes",
      inactive: "no",
    },
    {
      type: (prev) => (prev ? "autocompleteMultiselect" : false),
      name: "libs",
      message: "What libraries do you want to use?",
      hint: "  (select at least one)",
      choices: manifest.libs.map((library) => ({
        title: library,
        value: library,
      })),
    },
  ]);
  const target_dir = isInDatapacks
    ? path.resolve(
        process.cwd(),
        initial_options.datapack_name
          .replace(/[^a-zA-Z0-9\s]/g, "")
          .replace(/(.)\s+(.)/g, "$1_$2")
          .trim()
      )
    : process.cwd();
  const languages_promise = Promise.all(
    initial_options.languages.map((language) => {
      return fetch("http://api.mcbuild.dev/lang/" + language).then((res) =>
        res.json()
      );
    })
  );
  const libs_promise = Promise.all(
    (initial_options.libs || []).map((library) => {
      return fetch("http://api.mcbuild.dev/lib/" + library).then((res) =>
        res.json()
      );
    })
  );
  const config_options = await prompt([
    {
      type: "toggle",
      name: "config",
      message: "would you like to create a config?",
      initial: true,
      active: "yes",
      inactive: "no",
    },
    {
      type: (prev) => (prev ? "select" : false),
      name: "config_type",
      message: "what kind of config would you like?",
      choices: [
        { title: "js", value: "js" },
        { title: "json", value: "js" },
      ],
    },
  ]);
  const [languages, libs] = await Promise.all([
    languages_promise,
    libs_promise,
  ]);
  logger.task(`creating Data pack in ${target_dir}`);
  function write(location, content) {
    const dir = path.parse(location).dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(location, content);
  }
  write(
    path.resolve(target_dir, ".mcproject", "PROJECT.JSON"),
    JSON.stringify({ languages, libs }, null, 2)
  );
  write(
    path.resolve(target_dir, "pack.mcmeta"),
    JSON.stringify(
      {
        pack: {
          pack_format: initial_options.datapack_version,
          description:
            (isInDatapacks ? `${initial_options.datapack_name} - ` : "") +
            initial_options.datapack_description,
        },
      },
      null,
      2
    )
  );
  write(
    path.resolve(target_dir, "src", "hello.mc"),
    `
function load{
\tsay hello from ${initial_options.datapack_name}
}
`
  );
  if (config_options.config) {
    logger.task("creating config");
    let proc;
    proc = fork(process.argv[1], ["-config", config_options.config_type], {
      cwd: path.resolve(target_dir),
      stdio: [process.stdin, process.stdout, process.stderr, "ipc"],
      timeout: 60000,
    });
    try {
    } catch (e) {
      logger.error("an error occurred whilst generating the config.");
      logger.error("code: " + e.message);
      logger.log(e);
    }
    logger.log("done!");
  }
};
