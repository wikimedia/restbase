'use strict';

const HyperSwitch = require('hyperswitch');
const Template = HyperSwitch.Template;
const BaseFeed = require('../lib/base_feed');

const REQUEST_TEMPLATE = new Template({
    uri: '{{options.host}}/{{domain}}/v1/feed/onthisday/all/{{mm}}/{{dd}}'
});

class Feed extends BaseFeed {
    getDateAndKey(req) {
        return {
            date: undefined, // Never actually used
            key: `${req.params.mm}${req.params.dd}`
        };
    }

    constructBody(result) {
        return result.body;
    }

    _hydrateResponse(hyper, req, res) {
        if (req.params.type !== 'all') {
            res.body = {
                [req.params.type]: res.body[req.params.type]
            };
        }
        let hydratedResponse = super._hydrateResponse(hyper, req, res);

        // Hydration resolves re-directs so we need to de-dupe titles here *after* hydration.
        const removeDuplicateTitlesFromHydratedResponsePages = (response) => {
          Object.keys(response.body).forEach(key => {
            response.body[key].forEach(event => {
              event.pages = event.pages.filter(
                (item1, index, self) =>
                  self.findIndex(item2 => item2.title === item1.title) === index
              )
            });
          });
        };

        return hydratedResponse
        .then(removeDuplicateTitlesFromHydratedResponsePages)
        .thenReturn(hydratedResponse);
    }

    _makeFeedRequests(hyper, req) {
        return hyper.get(REQUEST_TEMPLATE.expand({
            options: this.options,
            request: req
        }));
    }
}

const spec = HyperSwitch.utils.loadSpec(`${__dirname}/onthisday.yaml`);

module.exports = (options) => {
    options.name = 'feed.onthisday';
    // TODO: need a way to dynamically derive this
    options.content_type = 'application/json; charset=utf-8; ' +
        'profile="https://www.mediawiki.org/wiki/Specs/onthisday-feed/0.5.0"';
    options.spec = spec;
    options.storeHistory = false;

    return new Feed(options).getModuleDeclaration();
};
