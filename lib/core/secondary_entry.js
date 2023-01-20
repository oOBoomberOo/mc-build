const fs = require('fs')
const path = require('path')
const { performance } = require('perf_hooks')

const interface = require('./interface')
const config = require('./config')
const logger = require('./log')
const io = require('./io')
const errors = require('./errors')
const fail = require('./error_loggers')
const shared = require('./shared_working')

const F_WRITE_CONFIG_TYPE =
	process.argv.indexOf('-config') != -1 &&
	process.argv[process.argv.indexOf('-config') + 1]
const F_LIB = Boolean(process.argv.find(arg => arg.startsWith('-lib=')))

const SRC_DIR = path.resolve(process.cwd() + '/src')
const {
	loadLanguages,
	languages,
	file_handlers,
	loadTransformers,
} = require('./load_language')

shared.set('languages', languages)

interface.addModule(
	path.resolve(__dirname, './lang_placeholder.js'),
	`!lang`,
	_ => languages
)
loadLanguages()
let transformers = null
if (F_LIB) {
	transformers = loadTransformers()
}

if (F_WRITE_CONFIG_TYPE) {
	if (
		fs.existsSync(path.resolve(process.cwd(), './config.js')) ||
		fs.existsSync(path.resolve(process.cwd(), './config.json'))
	) {
		logger.error(
			'config file exists, please remove or rename your current config if you would like to generate a new one'
		)
	} else if (F_WRITE_CONFIG_TYPE === 'js') {
		fs.writeFileSync(
			path.resolve(process.cwd(), './config.js'),
			`//generated config\nmodule.exports = ${JSON.stringify(
				config.config(),
				null,
				2
			)}`
		)
	} else if (F_WRITE_CONFIG_TYPE === 'json') {
		fs.writeFileSync(
			path.resolve(process.cwd(), './config.json'),
			JSON.stringify(config.config(), null, 2)
		)
	} else {
		logger.error(
			'invalid config extension, valid extensions are [js,json] got ' +
				F_WRITE_CONFIG_TYPE
		)
	}
	process.exit(1)
	return null
}

function dec(value) {
	const v = value.toString()
	if (v.indexOf('.') === -1) {
		return v + '.000'
	}
	const parts = v.split('.')
	return parts[0].concat('.', parts[1].substr(0, 3))
}

function performPreBuild() {
	const preBuild = config.config().global.preBuild
	if (typeof preBuild === 'function') {
		logger.task('starting preBuild')
		const start = performance.now()
		const res = preBuild({ file: null, config: config.config() })
		if (res instanceof Promise) {
			res.then(() => {
				const end = performance.now()
				logger.task(
					'finished preBuild after ' + dec(end - start) + 'ms'
				)
			})
		} else {
			const end = performance.now()
			logger.task('finished preBuild after ' + dec(end - start) + 'ms')
		}
	}
}

function performPostBuild(success) {
	if (typeof config.config().global.onBuildSuccess === 'function') {
		logger.error(
			'onBuildSuccess is depreciated and will be fully removed in v2.16. Use postBuild(build) {if (build.success) {...}} instead!'
		)
		if (success) {
			config.config().global.onBuildSuccess({
				success,
				file: null,
				config: config.config(),
			})
		}
	}
	const postBuild = config.config().global.postBuild
	if (typeof postBuild === 'function') {
		logger.task('starting postBuild')
		const start = performance.now()
		const res = postBuild({ success, file: null, config: config.config() })
		if (res instanceof Promise) {
			res.then(() => {
				const end = performance.now()
				logger.task(
					'finished postBuild after ' + dec(end - start) + 'ms'
				)
			})
		} else {
			const end = performance.now()
			logger.task('finished postBuild after ' + dec(end - start) + 'ms')
		}
	}
}

const rebuildProject = async () => {
	const compileStart = performance.now()
	const files = []
	performPreBuild()
	function getInitialFiles(location) {
		if (fs.lstatSync(location).isDirectory()) {
			const potential = fs.readdirSync(location)
			potential.forEach(f => {
				getInitialFiles(path.join(location, f))
			})
		} else {
			files.push(location)
		}
	}
	getInitialFiles(SRC_DIR)
	for (let i = 0; i < files.length; i++) {
		await compiler_handler(null, files[i], true)
	}
	Package.onBuildComplete.dispatch({ file: null, config: config.config() })
	performPostBuild(true)
	return compileStart
}

const compiler_handler = async (evt, file_path, DONT_FIRE_BUILD_SUCCESS) => {
	if (!DONT_FIRE_BUILD_SUCCESS) performPreBuild()
	Package.beforeBuildStart.dispatch({
		fsevent: evt,
		path: file_path,
		DONT_FIRE_BUILD_SUCCESS,
	})
	try {
		const start = performance.now()

		logger.task('build file: ' + path.relative(SRC_DIR, file_path))
		const parsedPath = path.parse(file_path)
		if (file_handlers.has(parsedPath.ext)) {
			await file_handlers.get(parsedPath.ext)(file_path)
		} else {
			logger.error(
				"did not find handler for file type '" + parsedPath.ext + "'"
			)
		}
		const startFS = performance.now()
		await io.syncFSToVirtual(file_path)
		const end = performance.now()
		if (evt === 'remove') {
			logger.info('rebuilding project.')
			io.flush()
			await rebuildProject()
			logger.info('done rebuilding project!')
		}
		logger.task(
			`finished task in ${dec(end - start)} ms, FileIO took ${dec(
				end - startFS
			)} ms`
		)
		if (!DONT_FIRE_BUILD_SUCCESS) performPostBuild(true)
	} catch (e) {
		if (e instanceof errors.CriticalError) {
			fail.critical(`failed to build file ${file_path}`, e, false)
		} else if (e instanceof errors.CompilerError) {
			fail.compiler(e)
			logger.task(`task failed!`)
		} else if (e instanceof errors.UserError) {
			fail.user(e)
			logger.task(`task failed!`)
		} else {
			fail.critical('unknown error', e)
		}
	}
}

//load the persistent config even if its not used. this is so that it will register its before exit event listener
const P_CONF = require('./persistent')
const Package = require('./pkg/package')
let buildInProgress = false

if (!process.argv.includes('-build')) {
	const configPath = config.getConfigPath()
	if (process.argv.includes('-w-alt')) {
		let buildDebounceTime = 100
		const index = process.argv.indexOf('-debounce-time')
		if (index >= 0) {
			if (process.argv.length < index + 1)
				logger.error('Expected value for -debounce-time')
			let value
			try {
				value = Number(process.argv[index + 1])
				buildDebounceTime = value
				logger.info(`Set build debounce time to ${buildDebounceTime}ms`)
			} catch (e) {
				logger.error(
					`Expected value for -debounce-time to be a number, got '${
						process.argv[index + 1]
					}'`
				)
			}
		}
		logger.warn("using non standard file watcher 'chokidar'")
		const chokidar = require('chokidar')
		chokidar.watch(SRC_DIR).on('all', (event, file_path) => {
			if (buildInProgress) {
				logger.warn(
					`Building too fast! Skipping build for file ${
						path.parse(file_path).base
					}. Rebuild if project not up to date.`
				)
				return
			}
			buildInProgress = true
			if (event === 'change') {
				compiler_handler('change', file_path, false)
			} else if (event === 'unlink') {
				compiler_handler('remove', file_path, false)
			}
			setTimeout(() => {
				buildInProgress = false
			}, buildDebounceTime)
		})
		if (fs.existsSync(configPath))
			chokidar.watch(configPath).on('change', () => {
				logger.warn(
					'the project config has changes, to use the updated config please restart mc-build'
				)
			})
	} else {
		const watch = require('node-watch')
		watch(SRC_DIR, { recursive: true }, compiler_handler)

		if (fs.existsSync(configPath))
			watch(configPath, () => {
				logger.warn(
					'the project config has changes, to use the updated config please restart mc-build'
				)
			})
	}
}

logger.info('doing initial build.')

rebuildProject().then(compileStart => {
	if (process.argv.find(arg => arg.startsWith('-lib='))) {
		const fs = require('fs')
		logger.info('running transforms on lib')
		const vfs = P_CONF.get('INTERNAL/VIRTUAL_FILE_SYSTEM')
		const manifest = {}
		for (let file in vfs) {
			const ext = path.parse(file).ext
			if (transformers[ext]) {
				manifest[path.relative(SRC_DIR, file)] = transformers[ext]({
					vfs,
					fs: vfs[file],
					source: path.resolve(process.cwd(), file),
					root: path.resolve(process.cwd()),
					ext,
					file: path.relative(SRC_DIR, file),
				})
			}
		}
		fs.writeFileSync('./build.json', JSON.stringify(manifest))

		logger.info('done running transforms on lib')
	}
	if (process.argv.includes('-build')) {
		const compileEnd = performance.now()
		logger.task(
			'finished project build in ' +
				dec(compileEnd - compileStart) +
				' ms'
		)
	}
	logger.info('done initial build... waiting for file changes')
})
