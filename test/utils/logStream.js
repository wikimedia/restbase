'use strict';

function logStream() {

  var log = [];
  
  function write(chunk, encoding, callback) {
    log.push(chunk);
  }

  // to implement the stream writer interface
  function end(chunk, encoding, callback) {
  } 

  function get() {
    return log;
  }

  function slice() {

    var begin = log.length;
    var end   = null;

    function halt() {
      if (end === null) {
        end = log.length;
      }
    }

    function get() {
      return log.slice(begin, end);
    }

    return {
      halt: halt,
      get: get
    };

  }

  return {
    write: write,
    end: end,
    slice: slice,
    get: get
  };
}

module.exports = logStream;
