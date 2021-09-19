const fs = require("fs");
const path = require("path");
const util = require("util");

const logger = require("./log");
const P_CONF = require("./persistent");
const error = require("./error_loggers");
const nextWriteActions = [];
const VFS = "INTERNAL/VIRTUAL_FILE_SYSTEM";
let VFS_STORED = P_CONF.has(VFS) ? P_CONF.get(VFS) : {};
const F_IS_LIB = process.argv.find((arg) => arg.startsWith("-lib="));
const hashstr = require("string-hash");
//rewrite config to store in the case that its
P_CONF.set(VFS, VFS_STORED);
let THREAD_POOL_SIZE = 32;
let TPS_IDX = process.argv.indexOf("--io-pool-size");
if(TPS_IDX>-1){
  THREAD_POOL_SIZE = Number(process.argv[TPS_IDX+1]) || 32
  if(THREAD_POOL_SIZE<=0)throw new Error("Invalid THREAD_POOL_SIZE, expected positive non 0 number");
}
class File {
  getPath() {
    return this._path;
  }
  setPath(path) {
    this._path = path;
  }
  getContents() {
    return this._contents;
  }
  setContents(contents) {
    this._contents = contents;
  }
  confirm() {
    nextWriteActions.push(this);
  }
  unregister() {
    if (nextWriteActions.indexOf(this) != -1) {
      nextWriteActions.splice(nextWriteActions.indexOf(this), 1);
    }
  }
}

function rm(dir) {
  if (dir.endsWith("data") || !fs.existsSync(dir)) {
    return;
  }
  if (fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    rm(path.resolve(dir, "../"));
  }
}
let queue = [];
async function syncFSToVirtual(file) {
  if (file) {
    file = path.relative(process.cwd(), file);
    const virtual = (VFS_STORED[file] = VFS_STORED[file] || {});
    let existingFiles = new Set(Object.keys(virtual));
    const nextVirtual = {};
    while (nextWriteActions.length) {
      const file = nextWriteActions.shift();
      const loc = file.getPath();
      const parsed = path.parse(loc);
      if (!F_IS_LIB) {
        if (!fs.existsSync(parsed.dir)) {
          fs.mkdirSync(parsed.dir, { recursive: true });
        }
      }
      const contents = file.getContents();
      if (!F_IS_LIB) {
        if(queue.length < THREAD_POOL_SIZE){
          let p = fs.promises.writeFile(loc, contents).then(()=>queue.splice(queue.indexOf(p),1));
          queue.push(p);
        }else{
          await Promise.race(queue);
          let p = fs.promises.writeFile(loc, contents).then(()=>queue.splice(queue.indexOf(p),1));
          queue.push(p);
        }
      }
      const stored_loc = path.relative(process.cwd(), loc);
      nextVirtual[stored_loc] = hashstr(contents);
      existingFiles.delete(stored_loc);
    }
    const dirs = new Set();
    if (!F_IS_LIB) {
      Array.from(existingFiles).forEach((file) => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
        dirs.add(path.parse(file).dir);
      });
    }
    VFS_STORED[file] = nextVirtual;
    if (!F_IS_LIB) {
      Array.from(dirs).forEach((dir) => {
        rm(dir);
      });
    }
    if (nextVirtual.length === 0) {
      delete VFS_STORED[file];
    }
  } else {
    Object.entries(VFS_STORED).map(([file, assosiations]) => {
      if (!fs.existsSync(file) && file.indexOf("minecraft") === -1) {
        syncFSToVirtual(file);
      }
    });
  }
}

function addFile(file) {
  file.confirm();
}

function flush() {
  VFS_STORED = {};
  P_CONF.set(VFS, VFS_STORED);
}
const os = require("os");
const LOCAL_DIR = os.platform().startsWith("win")?path.resolve(
  process.env.APPDATA,
  "mc-build",
  "local"
):path.resolve(
  os.homedir(),
  ".mc-build",
  "local"
);
function getCacheLocation(name) {
  const location = path.resolve(LOCAL_DIR, "..", "cache", name);
  fs.mkdirSync(location, { recursive: true });
  return location;
}
module.exports = { File, syncFSToVirtual, addFile, flush, getCacheLocation };
