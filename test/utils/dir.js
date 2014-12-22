'use strict';

var fs = require('fs');

var walk = function(dir, filelist) {
    filelist = filelist || [];
    var files = fs.readdirSync(dir);
    files.forEach(function(file) {
        if (fs.statSync(dir + file).isDirectory()) {
            filelist = walk(dir + file + '/', filelist);
        } else {
            filelist.push(dir + file);
        }
    });
    return filelist;
}; 

module.exports.walk = walk;
