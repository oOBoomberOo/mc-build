const path = require('path')
const os = require('os')
const LOCAL_DIR = os.platform().startsWith('win')
	? path.resolve(process.env.APPDATA, 'mc-build', 'local')
	: path.resolve(os.homedir(), '.mc-build', 'local')

module.exports.LOCAL_DIR = LOCAL_DIR
