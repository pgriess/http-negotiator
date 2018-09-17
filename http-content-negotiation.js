/*
 * Helper to construct value tuples
 */
const valueTuple = function(name, paramObj) {
    return [name, new Map(Object.entries(paramObj))];
};
exports.valueTuple = valueTuple;

/*
 * Given an array of AWS Lambda header objects for headers that support
 * ','-delimited list syntax, return a single array containing the values from
 * all of these lists.
 *
 * Assumptions
 *
 *  - HTTP headers arrive as an array of objects, each with a 'key' and 'value'
 *    property. We ignore the 'key' property as we assume the caller has supplied
 *    an array where these do not differ except by case.
 *
 *  - The header objects specified have values which conform to section 7 of RFC
 *    7230. For eample, Accept, Accept-Encoding support this. User-Agent does not.
 */
const splitHeaders = function(headers) {
    return headers.map(function(ho) { return ho['value']; })
        .reduce(
            function(acc, val) {
                return acc.concat(val.replace(/ +/g, '').split(','));
            },
            []);
};
exports.splitHeaders = splitHeaders;

/*
 * Parse an HTTP header value with optional parameters, returning a 2-element
 * array of [value name, parameter map].
 *
 * For example 'foo;q=1;a=bar' would return ['foo', Map{'q' => 1, 'a' => 'bar'}]
 * 
 * There are some gotchas here related to the 'q' parameter. The 'q' parameter
 * is guranteed to always be present in the resulting parameter object, with a
 * default value if 1. In addition, unlike other parameters, the value of the
 * 'q' parameter will have been parsed via parseFloat(). The values for all
 * other other parameters will be strings.
 */
const parseHeaderValue = function(v) {
    var params = new Map([['q', 1]]);

    const s = v.split(';');
    if (s.length > 0) {
        s.forEach(function(av, idx) {
            if (idx === 0) {
                return;
            }

            const kvp = av.split('=', 2)
            if (kvp[0] === 'q') {
                kvp[1] = parseFloat(kvp[1]);
            }

            params.set(kvp[0], kvp[1]);
        });
    }

    return [s[0], params];
};
exports.parseHeaderValue = parseHeaderValue;

/*
 * Given an array of 2-element [value name, parameter map] arrays, return a
 * sorted array of [value name, -value) tuples, ordered by the value of the
 * 'q' parameter.
 *
 * If multiple instances of the same value are found, the last instance will
 * override parameters of the earlier values.
 *
 * For example given the below header values, the output of this function will
 * be [['b', 3], ['a', 2]].
 *
 *      [['a', {'q': '5'}], ['a', {'q': '2'}], ['b', {'q': '3'}]]
 */
const sortHeadersByQValue = function(headerValues) {
    /* Filter out duplicates by name, preserving the last seen */
    var seen = new Set();
    const filteredValues = headerValues.slice().reverse().filter(function(pt) {
        let pn = pt[0];
        if (seen.has(pn)) {
            return false;
        }

        seen.add(pn);
        return true;
    });

    return filteredValues.sort(function(a, b) { return b[1].get('q') - a[1].get('q'); });
};
exports.sortHeadersByQValue = sortHeadersByQValue;

/*
 * Perform content negotiation.
 *
 * Given sorted arrays of supported (value name, q-value) tuples, select a
 * value that is mutuaully acceptable. Returns null is nothing could be found.
 */
const performNegotiation = function(clientValues, serverValues, matcher, comparator) {
    var scores = [];
    serverValues.forEach(function(sv) {
        /* Get all server values that match the given client value */
        const matchingCv = clientValues.filter(function(cv) { return matcher(sv[0], cv[0]); });
        if (matchingCv.length === 0) {
            return;
        }

        /* Pick the most specific server value for the current client value */
        const cv = matchingCv
            .sort(function(a, b) { return comparator(a[0], b[0]); })[0];

        const score = cv[1].get('q') * sv[1].get('q');
        if (score <= 0) {
            return;
        }

        /* Note that we push the server value here as it's expected not to be a wildcard */
        scores.push([sv[0], score]);
    });

    if (scores.length === 0) {
        return null;
    }

    return scores.sort(function(a, b) { return b[1] - a[1]; })[0][0];
};
exports.performNegotiation = performNegotiation;

/*
 * Matcher and comparator for strict literals.
 */
const strictValueMatch = function(a, b) { return a === b; };
exports.strictValueMatch = strictValueMatch;
const strictValueCompare = function(a, b) { return 0; };
exports.strictValueCompare = strictValueCompare;

/*
 * Matcher and comparator for wildcards.
 * 
 * For example, 'a' and '*' should match, but 'a' and 'b' should not. Wildcard
 * matches should take lower precedence than exact matches.
 */
const wildcardValueMatch = function(a, b) {
    if (a === '*' || b === '*') {
        return true;
    }

    return strictValueMatch(a, b);
};
exports.wildcardValueMatch = wildcardValueMatch;
const wildcardValueCompare = function(a, b) {
    if (a === '*' || b === '*') {
        if (a === '*' && b === '*') {
            return 0;
        } else if (a === '*') {
            return 1;
        } else {
            return -1;
        }
    }

    return strictValueCompare(a, b);
};
exports.wildcardValueCompare = wildcardValueCompare;

/*
 * Matcher and comparator for media ranges.
 * 
 * For example, 'text/plain' and 'text/*' should match, but 'text/plain' and
 * 'text/javascript' should not. Wildcard matches should take lower precedence
 * than exact matches.
 */
const mediaRangeValueMatch = function(a, b) {
    const aTypes = a.split('/');
    const bTypes = b.split('/');

    return wildcardValueMatch(aTypes[0], bTypes[0]) &&
        wildcardValueMatch(aTypes[1], bTypes[1]);
};
exports.mediaRangeValueMatch = mediaRangeValueMatch;
const mediaRangeValueCompare = function(a, b) {
    const aTypes = a.split('/');
    const bTypes = b.split('/');

    const c = wildcardValueCompare(aTypes[0], bTypes[0])
    if (c !== 0) {
        return c;
    }

    return wildcardValueCompare(aTypes[1], bTypes[1]);
};
exports.mediaRangeValueCompare = mediaRangeValueCompare;

/*
 * High-level wrapper to negotiate encoding.
 */
const awsNegotiateEncoding = function(headers, serverValues) {
    /* 
     * No Accept-Encoding header means the client will accept anything. Pick the
     * highest-scoring server value and go with that.
     */
    if (!('accept-encoding' in headers)) {
        return Array
            .from(serverValues)
            .sort(function(a, b) { return a[1].get('q') - b[1].get('q'); })
            .pop()[0];
    }

    /* Parse values and attributes */
    var parsedValues = splitHeaders(headers['accept-encoding'])
        .map(parseHeaderValue);

    /* 
     * If no parsed values match 'identity' (i.e. it has not been overridden)
     * add it as a default option per RFC 7231 section 5.3.4.
     * 
     * XXX: The RFC does not specify a default weight. We pick 1, but a case
     *      could be made to pick something like 0.1 with the assumption that
     *      anything else specified explicitly is likely to be more desirable than
     *      this default.
     * 
     * XXX: Does this imply that we should attempt CN *without* this implied value
     *      first and, only if there are no matches, then add it? That would make it
     *      the absolute last option which feels like it's really the intent of the
     *      RFC.
     */
    if (!parsedValues.some(function(v) { return wildcardValueMatch(v[0], 'identity'); })) {
        parsedValues.unshift(valueTuple('identity', {'q': 1}));
    }

    return performNegotiation(
        sortHeadersByQValue(parsedValues),
        serverValues,
        wildcardValueMatch,
        wildcardValueCompare);
};
exports.awsNegotiateEncoding = awsNegotiateEncoding;