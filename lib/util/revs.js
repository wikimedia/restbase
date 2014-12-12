"use strict";

var rbUtil = require('../rbUtil.js');

function updateRevTable(restbase, domain, bucket, key, revision, userId, userText, comment, tid) {
    return restbase.put({ // Save / update the revision entry
        uri: '/v1/' + domain + '/' + bucket + '.rev' + '/' + key,
        body: {
            table: bucket + '.rev',
            attributes: {
                page: key,
                rev: parseInt(revision),
                tid: tid,
                user_id: userId,
                user_text: userText,
                comment: comment
            }
        }
    });
}

function resolveMWOldid(restbase, domain, revision) {
    // Try to resolve MW oldids to tids
    return restbase.post({
        uri: '/v1/' + domain + '/_svc/action/query',
        body: {
            format: 'json',
            action: 'query',
            prop: 'revisions',
            rvprop: 'ids|timestamp|user|userid|size|sha1|contentmodel|comment',
                //titles: rp.key,
            revids: revision
        }
    })
    .then(function(apiRes) {
        if (apiRes.status === 200) {
            var apiRev = apiRes.body.items[0].revisions[0];
            return {
                tid: rbUtil.tidFromDate(new Date(apiRev.timestamp)),
                userId: apiRev.userid,
                userText: apiRev.user,
                comment: apiRev.comment
            };
        } else {
            throw new Error("Couldn't resolve MW oldid", apiRes);
        }
        });
}

function getTidFromDb(restbase, domain, bucket, key, revision) {
    // Check the local db
    var revTable = bucket + '.rev';
    return restbase.get({
        uri: '/v1/' + domain + '/' + revTable + '/' + key,
        body: {
            table: revTable,
            index: 'rev',
            proj: ['tid'],
            attributes: {
                page: key,
                rev: parseInt(revision)
            },
            limit: 2
        }
    }).then(function (res) {
        if (res.status === 200) {
            var tid = res.body.items[0].tid;
            return tid;
        } else {
            return null;
        }
    });
}

module.exports.updateRevTable = updateRevTable;
module.exports.resolveMWOldid = resolveMWOldid;
module.exports.getTidFromDb   = getTidFromDb;
