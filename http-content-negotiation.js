/*
 * The ValueTuple type.
 * 
 * This is the central data type in our library. The HTTP headers that we work
 * with are comprised lists of values separated by the ',' character. Each
 * value may have optional parameters, each separated by a ';' character. For
 * example the header 'Accept-Encoding: gzip, br;q=0.9, identity;q=0.1' would
 * be represented an array of 3 ValueTuple objects
 * 
 *  [
 *      ValueTuple{ value: 'gzip', properties: Map{} },
 *      ValueTuple{ value: 'br', properties: Map{ 'q' => 0.9 } },
 *      ValueTuple{ value: 'gzip', properties: Map{ 'q' => 0.1 } }
 *  ],
 * 
 * In addition, the 'q' property has special semantics -- we provide a
 * convenice attribute for accessing this directly, returning the default value
 * of 1 if it is un-specified.
 */
let ValueTuple = class {
    constructor(value, properties) {
        this.value = value;
        this.properties = properties;
    }

    get q() {
        const qv = this.properties.get('q');
        return (qv === undefined) ? 1 : qv;
    }
};
exports.ValueTuple = ValueTuple;

/*
 * Given a header value that supports ','-delimited list syntax, return an
 * array representing the list.
 * 
 * For example the header 'Accept-Encoding: gzip, br;q=0.9, identity;q=0.1'
 * would be split into 3 values
 * 
 *  [
 *      'gzip',
 *      'br;q=0.9',
 *      'identity;q=0.1'
 *  ]
 */
const splitHeaderValue = function(header) {
    return header.replace(/ +/g, '').split(',');
};
exports.splitHeaderValue = splitHeaderValue;

/*
 * Parse an HTTP header value into a ValueTuple.
 *
 * For example 'foo;q=1;a=2' would return
 * 
 *  ValueTuple{ value: 'foo', properties: Map{ 'q' => 1, 'a' => '2' } }
 * 
 * The 'q' parameter here is special. Unlike other parameters which are passed
 * through as un-interpted strings, 'q' will be run through parseFloat().
 */
const parseValueTuple = function(v) {
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

    return new ValueTuple(s[0], params);
};
exports.parseValueTuple = parseValueTuple;

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
    const filteredValues = headerValues.slice().reverse().filter(function(vt) {
        if (seen.has(vt.value)) {
            return false;
        }

        seen.add(vt.value);
        return true;
    });

    return filteredValues.sort(function(a, b) { return b.q - a.q; });
};
exports.sortHeadersByQValue = sortHeadersByQValue;

/*
 * Perform content negotiation.
 *
 * Given sorted arrays of supported (value name, q-value) tuples, select a
 * value that is mutuaully acceptable. Returns null is nothing could be found.
 * 
 * XXX: Need full write-up on expectations for matchers, comparators.
 * 
 * Matchers
 * 
 *      - No server wildcards
 *      - Comparing server offer vs. client requirements
 * 
 * Comparators
 * 
 *      - Only items which matched are compared
 *      - Comparing 2 server offers in context of client requirements
 */
const performNegotiation = function(clientValues, serverValues, matcher, comparator) {
    var scores = [];
    serverValues.forEach(function(sv) {
        /* Get all server values that match the given client value */
        const matchingCv = clientValues.filter(function(cv) { return matcher(sv, cv); });
        if (matchingCv.length === 0) {
            return;
        }

        /* Pick the most specific server value for the current client value */
        const cv = matchingCv
            .sort(function(a, b) { return comparator(a, b); })[0];

        const score = cv.q * sv.q;
        if (score <= 0) {
            return;
        }

        /*
         * Note that we push the server value here as it's expected not to be a wildcard
         */
        scores.push([sv, score]);
    });

    if (scores.length === 0) {
        return null;
    }

    return scores.sort(function(a, b) { return b[1] - a[1]; })[0][0];
};
exports.performNegotiation = performNegotiation;

/*
 * Matcher and comparator for parameters.
 */
const parameterMatch = function(sp, cp) {
    for (spt of sp) {
        const spn = spt[0];
        const spv = spt[1];

        /* The 'q' parameter is special; skip it */
        if (spn === 'q') {
            continue;
        }

        /* 
         * If the client hasn't specified a value for this parameter, consider
         * that implicit acceptance; skip it
         */
        if (!cp.has(spn)) {
            continue;
        }

        if (spv !== cp.get(spn)) {
            return false;
        }
    }

    for (cpt of cp) {
        const cpn = cpt[0];

        if (cpn !== 'q' && !sp.has(cpn)) {
            return false;
        }
    }

    return true;
};
exports.parameterMatch = parameterMatch;

/*
 * TODO: Implement me!
 * 
 * XXX: Requires the client params that we're matching against as otherwise we
 *      don't know which is better *relative to that*.
 * 
 * XXX: Look at qvalues here and get rid of sortHeadersByQValue()
 */
const parameterCompare = function(ap, bp) {
    return 0;
};
exports.parameterCompare = parameterCompare;

/*
 * Matcher and comparator for strict literals.
 */
const strictValueMatch = function(st, ct) {
    if (st.value !== ct.value) {
        return false;
    }

    return parameterMatch(st.properties, ct.properties);
};
exports.strictValueMatch = strictValueMatch;

const strictValueCompare = function(at, bt) {
    return parameterCompare(at.properties, bt.properties);
};
exports.strictValueCompare = strictValueCompare;

/*
 * Matcher and comparator for wildcards.
 * 
 * For example, 'a' and '*' should match, but 'a' and 'b' should not. Wildcard
 * matches should take lower precedence than exact matches.
 */
const wildcardValueMatch = function(st, ct) {
    if (ct.value === '*') {
        return parameterMatch(st.properties, ct.properties);
    }

    return strictValueMatch(st, ct);
};
exports.wildcardValueMatch = wildcardValueMatch;

const wildcardValueCompare = function(at, bt) {
    if (at.value === '*' || bt.value === '*') {
        if (at.value === '*' && bt.value === '*') {
            return parameterCompare(at.properties, bt.properties);
        } else if (at.value === '*') {
            return 1;
        } else {
            return -1;
        }
    }

    return strictValueCompare(at, bt);
};
exports.wildcardValueCompare = wildcardValueCompare;

/*
 * Matcher and comparator for media ranges.
 * 
 * For example, 'text/plain' and 'text/*' should match, but 'text/plain' and
 * 'text/javascript' should not. Wildcard matches should take lower precedence
 * than exact matches.
 */
const mediaRangeValueMatch = function(st, ct) {
    const EMPTY_PARAMS = new Map();

    const sTypes = st.value.split('/');
    const cTypes = ct.value.split('/');

    return wildcardValueMatch(
            new ValueTuple(sTypes[0], EMPTY_PARAMS),
            new ValueTuple(cTypes[0], EMPTY_PARAMS)) &&
        wildcardValueMatch(
            new ValueTuple(sTypes[1], st.properties),
            new ValueTuple(cTypes[1], ct.properties));
};
exports.mediaRangeValueMatch = mediaRangeValueMatch;

const mediaRangeValueCompare = function(at, bt) {
    const aTypes = at.value.split('/');
    const bTypes = bt.value.split('/');

    /* XXX: This may be wrong. Should we compare parameters entirely ater the types? */
    const c = wildcardValueCompare(
        new ValueTuple(aTypes[0], at.properties),
        new ValueTuple(bTypes[0], bt.properties));
    if (c !== 0) {
        return c;
    }

    return wildcardValueCompare(
        new ValueTuple(aTypes[1], at.properties),
        new ValueTuple(bTypes[1], bt.properties));
};
exports.mediaRangeValueCompare = mediaRangeValueCompare;

/*
 * Split headers from AWS input.
 * 
 * This differs from splitHeaderValue in that it accepts AWS header object as
 * input and handles merging multiple instances of a single header.
 */
const awsSplitHeaderValue = function(headers) {
    return headers.map(function(ho) { return ho['value']; })
        .reduce((a, v) => { return a.concat(splitHeaderValue(v)); }, []);
};
exports.awsSplitHeaderValue = awsSplitHeaderValue;

/*
 * Perform content negotiation from AWS input.
 * 
 * This is a high-level wrapper around the rest of the functions in this file.
 * Applications should probably just use this directly.
 */
const awsNegotiateEncoding = function(headers, serverValues) {
    const IDENTITY = new ValueTuple('identity', new Map([['q', 1]]));

    /* 
     * No Accept-Encoding header means the client will accept anything. Pick the
     * highest-scoring server value and go with that.
     */
    if (!('accept-encoding' in headers)) {
        return Array
            .from(serverValues)
            .sort(function(a, b) { return a.q - b.q; })
            .pop().value;
    }

    /* Parse values and attributes */
    var parsedValues = awsSplitHeaderValue(headers['accept-encoding'])
        .map(parseValueTuple);

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
    if (!parsedValues.some((v) => { return wildcardValueMatch(IDENTITY, v); })) {
        parsedValues.unshift(IDENTITY);
    }

    const sv = performNegotiation(
        sortHeadersByQValue(parsedValues),
        serverValues,
        wildcardValueMatch,
        wildcardValueCompare);
    if (!sv) {
        return sv;
    }

    return sv.value;
};
exports.awsNegotiateEncoding = awsNegotiateEncoding;