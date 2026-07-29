/**
 * Test harness setup.
 *
 * Node 25 removed the long-deprecated `buffer.SlowBuffer`, which
 * `buffer-equal-constant-time` (pulled in by jsonwebtoken@8 via jwa/jws) still
 * reads at import time. The project pins Node 24 in .nvmrc, where it exists, so
 * this shim only keeps the suite runnable for anyone on a newer runtime.
 *
 * Remove it once jsonwebtoken is upgraded to v9, which drops that dependency.
 */
const buffer = require("buffer");

if (typeof buffer.SlowBuffer === "undefined") {
  buffer.SlowBuffer = function SlowBuffer(size) {
    return Buffer.alloc(size);
  };
  buffer.SlowBuffer.prototype = Object.create(Buffer.prototype);
}
