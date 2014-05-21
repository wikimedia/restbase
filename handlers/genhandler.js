// Run with 'node --harmony' using node 0.11+

/*
 * env.{GET,PUT,..} provides a virtual REST service by mapping paths to
 * backend requests. Returns promises.
 */
function* handleGet (env, req) {
    // Try the backend first
    var beResp = yield env.GET(req);
    if (beResp.status === 200) {
        // all done
        return beResp;
    } else if (beResp.status === 404) {
        // Try to generate the request with Parsoid
        var parsoidResp = yield env.GET('/v1/_parsoid/' + env.account + req.uri);
        if (parsoidResp.status === 200) {
            // Asynchronously save back the HTML, don't wait for it to finish
			env.PUT({
				uri: req.uri,
				headers: parsoidResp.headers,
				body: parsoidResp.body
			});
        }
        return parsoidResp;
    }
}

// Register handler for end point
module.exports = {
	get: ['/v1/:account/pages/:title/rev/:rev/html', handleGet]
};
