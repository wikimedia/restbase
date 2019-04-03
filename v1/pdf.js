'use strict';

const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/pdf.yaml`);

function filenameParameters(name) {
    // Return two parameters
    const encodedName = `${encodeURIComponent(name)}.pdf`;
    const quotedName = `"${encodedName.replace(/"/g, '\\"')}"`;
    return `filename=${quotedName}; filename*=UTF-8''${encodedName}`;
}

/**
 * PDF filename formatting / escaping utilities.
 * @param   {Object}    options
 * @return  {Object}             response with headers and PDF in body
 */
module.exports = (options) => ({
    spec,
    globals: {
        options
    },
    operations: {
        generatePDF: (hyper, req) => {
            const rp = req.params;
            const newProbability = options.new_probability || 0;
            return hyper.get(new URI([rp.domain, 'sys', 'page_revisions', 'page', rp.title]))
            .then((latestRevision) => {
                if (options.new_uri && (Math.random() < newProbability || req.query.new_pdf)) {
                    const newResult = hyper.get(new URI(
                        `${options.new_uri}/${rp.domain}/v1/` +
                        `pdf/${encodeURIComponent(rp.title)}/a4/desktop`
                    ))
                    .catch((e) => {
                        hyper.logger.log('error/proton', e);
                        if (req.query.new_pdf) {
                            throw e;
                        }
                    });
                    if (req.query.new_pdf) {
                        return newResult;
                    }
                }
                return hyper.get({
                    uri: new URI(`${options.uri}/pdf`),
                    query: {
                        accessKey: options.secret,
                        url: `${options.scheme || 'https'}://${rp.domain}/wiki/`  +
                            `${encodeURIComponent(rp.title)}?printable=yes`
                    }
                })
                .then((res) => {
                    return {
                        status: 200,
                        headers: {
                            'content-disposition': `attachment; ${filenameParameters(rp.title)}`,
                            'content-type': res.headers['content-type'],
                            'content-length': res.headers['content-length'],
                            'cache-control': options['cache-control'] ||
                                's-maxage=600, max-age=600',
                            etag: latestRevision.headers.etag
                        },
                        body: res.body
                    };
                });
            });
        }
    }
});
