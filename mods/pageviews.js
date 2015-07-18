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

/* general handler functions */
var queryCatcher = function(e) {
        if (e.status !== 404) {
            throw e;
        }
    };
var queryResponser = function(res) {
        // always return at least an empty array so that queries for non-existing data don't error
        res = res || {};
        res.body = res.body || { items: [] };
        res.headers = res.headers || {};
        res.status = res.status || 200;
        return res;
    };


PJVS.prototype.pageviewsForArticle = function(restbase, req) {
    var rp = req.params;
    var dataRequest;

    dataRequest = restbase.get({
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

    }).catch(queryCatcher);

    return dataRequest.then(queryResponser);
};

PJVS.prototype.pageviewsForProjects = function(restbase, req) {
    var rp = req.params;
    var dataRequest;

    dataRequest = restbase.get({
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

    }).catch(queryCatcher);

    return dataRequest.then(queryResponser);
};

PJVS.prototype.pageviewsForTops = function(restbase, req) {
    var rp = req.params;
    var dataRequest;

    if (rp.year === 'all-years') {
        rp.month = 'all-months';
    }
    if (rp.month === 'all-months') {
        rp.day = 'all-days';
    }

    dataRequest = restbase.get({
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

    }).catch(queryCatcher);

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
