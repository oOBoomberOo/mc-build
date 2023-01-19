Array.prototype.flat = Array.prototype.flat || ((depth = Infinity) => {
    const res = [];
    for (let i = 0; i < this.length; i++) {
        if (Array.isArray(this[i]) && depth) {
            res.push.apply(res, flat(this[i], depth));
        } else {
            res.push(this[i]);
        }
    }
    return res;
});