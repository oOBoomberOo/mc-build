require("../patch/array.flat");




const fetch = require("node-fetch");
const download = require("download");
const { performance } = require("perf_hooks");
const fs = require("fs");
const path = require("path");
const thread = require("child_process");
const rimraf = require("rimraf");

function removeDir(dir) {
    return new Promise((resolve, reject) => {
        rimraf(dir, (error) => {
            if (error) reject(error);
            resolve();
        })
    });
}

const logger = require("./log");
const SAVE_DIR = path.resolve(process.cwd(), "./.mcproject");
const LOCAL_DIR = path.resolve(process.env.APPDATA || path.resolve(__dirname, '..', '..', 'unix-appdata-store'), 'mc-build', 'local');
fs.mkdirSync(LOCAL_DIR, { recursive: true });
const PROJECT_LOC = path.resolve(SAVE_DIR, 'PROJECT.json');

let manifest = {
    languages: [
        {
            name: "lang-mc/stable",
            remote: {
                type: "github",
                owner: "mc-build"
            }
        }
    ],
    libs: []
};
if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR);
}
if (fs.existsSync(PROJECT_LOC)) {
    manifest = require(PROJECT_LOC);
} else {
    fs.writeFileSync(PROJECT_LOC, JSON.stringify(manifest, null, 2));
    manifest = require(PROJECT_LOC);
}
(async () => {
    function resolveOfTypeFrom(type, item) {
        switch (item.remote.type) {
            case "github": {
                let [name, version] = item.name.split("/");
                version = version || "stable";
                return fetch(`https://api.github.com/repos/${item.remote.owner}/${name}/branches/${version}`)
                    .then((res) => res.json())
                    .then((data) => {
                        return {
                            _raw: data,
                            sha: data.commit.sha,
                            item: item,
                            type,
                            name,
                            version
                        }
                    });
            }
            case "file": {
                let [name, version] = item.name.split("/");
                return Promise.resolve(
                    {
                        _raw: item,
                        sha: "NO_SHA_LANG_LOADED_FROM_FILE_SYSTEM",
                        item: item,
                        type,
                        name,
                        version
                    }
                );
            }
        }
    }
    if (!manifest.libs) {
        manifest.libs = [];
        fs.writeFileSync(PROJECT_LOC, JSON.stringify(manifest, null, 2));
    }
    const promises = manifest.languages.map((language) => resolveOfTypeFrom("language", language));
    promises.push(...manifest.libs.map((lib) => resolveOfTypeFrom("library", lib)));
    const download_tasks = [];
    (await Promise.all(promises)).forEach((task) => {
        if (!fs.existsSync(path.resolve(LOCAL_DIR, task.sha))) {
            download_tasks.push(task);
        }
    });
    if (!fs.existsSync(path.resolve(LOCAL_DIR))) {
        fs.mkdirSync(path.resolve(LOCAL_DIR));
    }
    if (!fs.existsSync(path.resolve(LOCAL_DIR, '.cache'))) {
        fs.mkdirSync(path.resolve(LOCAL_DIR, '.cache'));
    }
    for (let i = 0; i < download_tasks.length; i++) {
        const start = performance.now();
        const task = download_tasks[i];
        const item = task.item;
        const category = task.type;
        let { name, version } = task;
        const TARGET_DIR = path.resolve(LOCAL_DIR, '.cache', category, task.name, version);
        let DISK_DIR = TARGET_DIR;
        if (item.remote.type === "github") {
            const SHA_PATH = path.resolve(LOCAL_DIR, '.sha', category, name);
            if (fs.existsSync(path.resolve(path.resolve(SHA_PATH, version)))
                && task.sha === fs.readFileSync(path.resolve(SHA_PATH, version), "utf-8")
            ) {
                logger.log("using cache for " + item.type + " '" + task.item.name + "'");
            } else {
                version = version || "stable";
                logger.info(`downloading ${item.type} ${name} branch ${version} from '${`https://github.com/${task.item.remote.owner}/${name}/archive/${task.sha}.zip'`}`);
                removeDir(TARGET_DIR);
                await download(
                    `https://github.com/${task.item.remote.owner}/${name}/archive/${task.sha}.zip`,
                    TARGET_DIR,
                    {
                        extract: true,
                        "strip": 1
                    }
                );
                if (!fs.existsSync(SHA_PATH)) {
                    fs.mkdirSync(SHA_PATH, { recursive: true });
                }
                fs.writeFileSync(path.resolve(SHA_PATH, version), task.sha);
                const end = performance.now();
                logger.info(`finished download in ${end - start}ms`);
            }
        }
        if (item.remote.type === "file") {
            DISK_DIR = item.remote.path;
        }
        if (task.type === "library" && !fs.existsSync(path.resolve(DISK_DIR, 'build.json'))) {
            await new Promise((resolve) => {
                const start = performance.now();
                logger.log(`building library ${name}!`);
                const cp = thread.exec([
                    process.argv[0],
                    path.resolve(__dirname, '..', '..', 'cli.js'),
                    "-lib=" + name,
                    "-build",
                ].join(" "), {
                    cwd: DISK_DIR
                });
                cp.stdout.on("data", (message) => {
                    process.stdout.write(message.toString());
                });
                cp.stderr.on("data", (message) => {
                    process.stderr.write(message.toString());
                });
                cp.on("error", (error) => {
                    throw error;
                });
                cp.on("exit", () => {
                    logger.log(`done building library ${name} in ${performance.now() - start}ms!`);
                    resolve();
                });
            });
        }

        item.remote._loc = DISK_DIR;
    }
    logger.log("starting mc-build...");
    require("./secondary_entry");
})();