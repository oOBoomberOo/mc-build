const logger = require('../log')
const { performance } = require('perf_hooks')
class DispatchableEvent {
	constructor(name) {
		this.funcs = []
		this.name = name
	}
	add(func) {
		this.funcs.push(func)
	}
	dispatch(payload) {
		if (this.funcs.length) {
			logger.task('starting ' + this.name)
			const start = performance.now()
			this.funcs.forEach(cb => cb(payload))
			const end = performance.now()
			logger.task('done ' + this.name + ' in ' + (end - start) + 'ms')
		}
	}
}
module.exports = class Package {
	static onBuildComplete = new DispatchableEvent('Package:onBuildComplete')
	static beforeBuildStart = new DispatchableEvent('Package:beforeBuildStart')
}
