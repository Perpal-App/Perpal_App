const nativeFetch = globalThis.fetch;

module.exports = nativeFetch;
module.exports.default = nativeFetch;
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;
