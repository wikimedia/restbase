'use strict';

/**
 * Pageviews API module
 *
 * This API serves pre-aggregated pageview statistics from Cassandra
 */

var URI = require('swagger-router').URI;

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
    articleFlat: 'pageviews.per.article.flat',
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
    articleFlat: {
        table: tables.articleFlat,
        version: 1,
        attributes: {
            project: 'string',
            article: 'string',
            granularity: 'string',
            // the hourly timestamp will be stored as YYYYMMDDHH
            timestamp: 'string',

            // we are collapsing two of our dimensions because we were taking up a LOT
            // of storage space with the previous schema
            views_all_access_all_agents: 'int', // views for all-access, all-agents
            views_all_access_bot: 'int',        // views for all-access, bot
            views_all_access_spider: 'int',     // views for all-access, spider
            views_all_access_user: 'int',       // views for all-access, user

            views_desktop_all_agents: 'int',    // views for desktop, all-agents
            views_desktop_bot: 'int',           // views for desktop, bot
            views_desktop_spider: 'int',        // views for desktop, spider
            views_desktop_user: 'int',          // views for desktop, user

            views_mobile_app_all_agents: 'int', // views for mobile-app, all-agents
            views_mobile_app_bot: 'int',        // views for mobile-app, bot
            views_mobile_app_spider: 'int',     // views for mobile-app, spider
            views_mobile_app_user: 'int',       // views for mobile-app, user

            views_mobile_web_all_agents: 'int', // views for mobile-web, all-agents
            views_mobile_web_bot: 'int',        // views for mobile-web, bot
            views_mobile_web_spider: 'int',     // views for mobile-web, spider
            views_mobile_web_user: 'int'        // views for mobile-web, user
        },
        index: [
            { attribute: 'project', type: 'hash' },
            { attribute: 'article', type: 'hash' },
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
var normalizeResponse = function(res) {
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

    if (rp.year === 'all-years' && (rp.month !== 'all-months' || rp.day !== 'all-days')) {
        errors.push(
            'month must be "all-months" and day must be "all-days" when passing "all-years"'
        );
    }
    if (rp.month === 'all-months' && rp.day !== 'all-days') {
        errors.push('day must be "all-days" when passing "all-months"');
    }

    // the errors above are better by themselves, so throw them if they're there
    throwIfNeeded(errors);

    // fake a timestamp in the YYYYMMDDHH format so we can reuse the validator
    var validDate = validateTimestamp(
        ((rp.year === 'all-years') ? '2015' : rp.year) +
        ((rp.month === 'all-months') ? '01' : rp.month) +
        ((rp.day === 'all-days') ? '01' : rp.day) +
        '00'
    );

    if (!validDate) {
        var invalidPieces = [];
        if (rp.year !== 'all-years') { invalidPieces.push('year'); }
        if (rp.month !== 'all-months') { invalidPieces.push('month'); }
        if (rp.day !== 'all-days') { invalidPieces.push('day'); }

        errors.push(
            invalidPieces.join(', ') +
            (invalidPieces.length > 1 ? ' are' : ' is') +
            ' invalid'
        );
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

    return dataRequest.then(normalizeResponse);
};

PJVS.prototype.pageviewsForArticleFlat = function(restbase, req) {
    var rp = req.params;

    validateStartAndEnd(rp);

    var dataRequest = restbase.get({
        uri: tableURI(rp.domain, tables.articleFlat),
        body: {
            table: tables.articleFlat,
            attributes: {
                project: rp.project,
                article: rp.article,
                granularity: rp.granularity,
                timestamp: { between: [rp.start, rp.end] },
            }
        }

    });

    function viewKey(access, agent) {
        var ret = ['views', access, agent].join('_');
        return ret.replace(/-/g, '_');
    }

    function removeDenormalizedColumns(item) {
        ['all-access', 'desktop', 'mobile-app', 'mobile-web'].forEach(function(access) {
            ['all-agents', 'bot', 'spider', 'user'].forEach(function(agent) {
                delete item[viewKey(access, agent)];
            });
        });
    }

    return dataRequest.then(normalizeResponse).then(function(res) {
        if (res.body.items) {
            res.body.items.forEach(function(item) {
                item.access = rp.access;
                item.agent = rp.agent;
                item.views = item[viewKey(rp.access, rp.agent)];
                removeDenormalizedColumns(item);
            });
        }

        return res;
    });
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

    return dataRequest.then(normalizeResponse);
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

    return dataRequest.then(normalizeResponse);
};


module.exports = function(options) {
    var pjvs = new PJVS(options);

    return {
        spec: spec,
        operations: {
            // TODO: switch to this handler once flat table is loaded
            // pageviewsForArticle: pjvs.pageviewsForArticleFlat.bind(pjvs),
            pageviewsForArticle: pjvs.pageviewsForArticle.bind(pjvs),
            pageviewsForProjects: pjvs.pageviewsForProjects.bind(pjvs),
            pageviewsForTops: pjvs.pageviewsForTops.bind(pjvs),
        },
        resources: [
            {
                // pageviews per article table
                // TODO: remove once we are using the pageviewsForArticleFlat handler
                uri: '/{domain}/sys/table/' + tables.article,
                body: tableSchemas.article,
            }, {
                // new pageviews per article table (needed to load flattened data for space reasons)
                uri: '/{domain}/sys/table/' + tables.articleFlat,
                body: tableSchemas.articleFlat,
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
