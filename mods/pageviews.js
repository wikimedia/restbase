'use strict';

/**
 * Pageviews API module
 *
 * Main tasks:
 * - TBD
 */


var URI = require('swagger-router').URI;

// TODO: move to module
var fs = require('fs');
var yaml = require('js-yaml');
var path = require('path');
var spec = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '/pageviews.yaml')));
var rbUtil = require('../lib/rbUtil');


// Pageviews Service
function PJVS(options) {
    this.options = options;
    this.log = options.log || function() {};
}


var tables = {
    article: 'pageviews.per.article',
    project: 'pageviews.per.project',
    tops: 'top.pageviews',
};
var tableURI = function(domain, tableName) {
    return new URI([domain, 'sys', 'table', tableName, '']);
};
var tableSchemas = {
    article: {
        table: tables.article,
        version: 1,
        attributes: {
            project: 'string',
            article: 'string',
            access: 'string',
            agent: 'string',
            granularity: 'string',
            // the hourly timestamp will be stored as YYYYMMDDHH
            timestamp: 'string',
            views: 'int'
        },
        index: [
            { attribute: 'project', type: 'hash' },
            { attribute: 'article', type: 'hash' },
            { attribute: 'access', type: 'hash' },
            { attribute: 'agent', type: 'hash' },
            { attribute: 'granularity', type: 'hash' },
            { attribute: 'timestamp', type: 'range', order: 'asc' },
        ]
    },
    project: {
        table: tables.project,
        version: 1,
        attributes: {
            project: 'string',
            access: 'string',
            agent: 'string',
            granularity: 'string',
            // the hourly timestamp will be stored as YYYYMMDDHH
            timestamp: 'string',
            views: 'int'
        },
        index: [
            { attribute: 'project', type: 'hash' },
            { attribute: 'access', type: 'hash' },
            { attribute: 'agent', type: 'hash' },
            { attribute: 'granularity', type: 'hash' },
            { attribute: 'timestamp', type: 'range', order: 'asc' },
        ]
    },
    tops: {
        table: tables.tops,
        version: 1,
        attributes: {
            project: 'string',
            access: 'string',
            year: 'string',
            month: 'string',
            day: 'string',
            // format for this is a json array: [{rank: 1, article: <<title>>, views: 123}, ...]
            articles: 'string'
        },
        index: [
            { attribute: 'project', type: 'hash' },
            { attribute: 'access', type: 'hash' },
            { attribute: 'year', type: 'hash' },
            { attribute: 'month', type: 'hash' },
            { attribute: 'day', type: 'hash' },
        ]
    }
};

/**
 * general handler functions */
var queryResponser = function(res) {
    // always return at least an empty array so that queries for non-existing data don't error
    res = res || {};
    res.body = res.body || { items: [] };
    res.headers = res.headers || {};
    // NOTE: We decided to let "data not found" be reported as a 404.  We have a work-around if
    // consumers complain that they prefer a 204 instead:
    //   We could catch the 404 and run the same query without the date parameters.  If we find
    //   results (use limit 1 for efficiency), we could then return a 204 because we'd know the
    //   dates were the part of the query that wasn't found.
    return res;
};

/**
 * Parameter validators
 */
var throwIfNeeded = function(errors) {
    if (errors && errors.length) {
        throw new rbUtil.HTTPError({
            status: 400,
            body: {
                type: 'invalid_request',
                detail: errors,
            }
        });
    }
};

/**
 * Cleans the project parameter so it can be passed in as either en.wikipedia.org or en.wikipedia
 */
var stripOrgFromProject = function(rp) {
    rp.project = rp.project.replace(/\.org$/, '');
};


var validateTimestamp = function(timestamp) {
    if (!/^[0-9]{10}$/.test(timestamp)) {
        return false;
    }

    var year = timestamp.substring(0, 4);
    var month = timestamp.substring(4, 6);
    var day = timestamp.substring(6, 8);
    var hour = timestamp.substring(8, 10);

    var dt = new Date([year, month, day].join('-') + ' ' + hour + ':00:00 UTC');

    return dt.toString() !== 'Invalid Date'
        && dt.getUTCFullYear() === parseInt(year, 10)
        && dt.getUTCMonth() === (parseInt(month, 10) - 1)
        && dt.getUTCDate() === parseInt(day, 10)
        && dt.getUTCHours() === parseInt(hour);
};


var validateStartAndEnd = function(rp) {
    var errors = [];

    stripOrgFromProject(rp);

    if (!validateTimestamp(rp.start)) {
        errors.push('start timestamp is invalid, must be a valid date in YYYYMMDDHH format');
    }
    if (!validateTimestamp(rp.end)) {
        errors.push('end timestamp is invalid, must be a valid date in YYYYMMDDHH format');
    }

    if (rp.start > rp.end) {
        errors.push('start timestamp should be before the end timestamp');
    }

    throwIfNeeded(errors);
};

var validateYearMonthDay = function(rp) {
    var errors = [];

    stripOrgFromProject(rp);

    if (rp.year === 'all-years') {
        rp.month = 'all-months';
    }
    if (rp.month === 'all-months') {
        rp.day = 'all-days';
    }

    if (rp.year !== 'all-years' && !/^[0-9]{4}$/.test(rp.year)) {
        errors.push('year must be "all-years" or a 4 digit number');
    }

    if (rp.month !== 'all-months' && !/^[0-9]{2}$/.test(rp.month)) {
        errors.push('month must be "all-months" or a 2 digit number');
    }

    if (rp.day !== 'all-days' && !/^[0-9]{2}$/.test(rp.day)) {
        errors.push('day must be "all-days" or a 2 digit number');
    }

    throwIfNeeded(errors);
};

PJVS.prototype.pageviewsForArticle = function(restbase, req) {
    var rp = req.params;

    validateStartAndEnd(rp);

    var dataRequest = restbase.get({
        uri: tableURI(rp.domain, tables.article),
        body: {
            table: tables.article,
            attributes: {
                project: rp.project,
                access: rp.access,
                agent: rp.agent,
                article: rp.article,
                granularity: rp.granularity,
                timestamp: { between: [rp.start, rp.end] },
            }
        }

    });

    return dataRequest.then(queryResponser);
};

PJVS.prototype.pageviewsForProjects = function(restbase, req) {
    var rp = req.params;

    validateStartAndEnd(rp);

    var dataRequest = restbase.get({
        uri: tableURI(rp.domain, tables.project),
        body: {
            table: tables.project,
            attributes: {
                project: rp.project,
                access: rp.access,
                agent: rp.agent,
                granularity: rp.granularity,
                timestamp: { between: [rp.start, rp.end] },
            }
        }

    });

    return dataRequest.then(queryResponser);
};

PJVS.prototype.pageviewsForTops = function(restbase, req) {
    var rp = req.params;

    validateYearMonthDay(rp);

    var dataRequest = restbase.get({
        uri: tableURI(rp.domain, tables.tops),
        body: {
            table: tables.tops,
            attributes: {
                project: rp.project,
                access: rp.access,
                year: rp.year,
                month: rp.month,
                day: rp.day
            }
        }

    });

    return dataRequest.then(queryResponser);
};


module.exports = function(options) {
    var pjvs = new PJVS(options);

    return {
        spec: spec,
        operations: {
            pageviewsForArticle: pjvs.pageviewsForArticle.bind(pjvs),
            pageviewsForProjects: pjvs.pageviewsForProjects.bind(pjvs),
            pageviewsForTops: pjvs.pageviewsForTops.bind(pjvs),
        },
        resources: [
            {
                // pageviews per article table
                uri: '/{domain}/sys/table/' + tables.article,
                body: tableSchemas.article,
            }, {
                // pageviews per project table
                uri: '/{domain}/sys/table/' + tables.project,
                body: tableSchemas.project,
            }, {
                // top pageviews table
                uri: '/{domain}/sys/table/' + tables.tops,
                body: tableSchemas.tops,
            }
        ]
    };
};
