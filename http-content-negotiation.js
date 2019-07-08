'use strict';

const EMPTY_MAP = new Map();

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
 * The 'q' parameter has special semantics -- we provide a convenice property
 * for accessing this directly, returning the default value of 1 if it is
 * un-specified.
 *
 * Finally, there is a 'score' property. This is undefined by default, but it
 * can be used by the negotiation process to indicate the score of a given choice.
 */
const ValueTuple = class {
    constructor(value, properties, score) {
        this.value = value;
        this.properties = properties || new Map();
        this.score = score;
    }

    get q() {
        const qv = this.properties.get('q');
        return (qv === undefined) ? 1 : qv;
    }
};
exports.ValueTuple = ValueTuple;

/*
 * Matchers and comparators
 *
 * Matchers are used to determine whether a single server ValueTuple will
 * satisfy the requirements of a single client ValueTuple. These are used in
 * performNegotiation() to determine the compatability matrix of the various
 * content options being requested and offered. Matchers are invoked
 * as (serverTuple, clientTuple) and return a truthy value.
 *
 * Comparators are used to select the client ValueTuple that *best* satisfies
 * the requirements of a single server ValueTuple. Comparators are invoked as
 * (serverTuple, clientTupleA, clientTupleB) and return less than 0 if A is
 * preferable to B, 0 if they are equalivalent, and greater than zero if B is
 * preverable to A. All client ValueTuples that are passed to comparators are
 * guaranteed to have passed the relevant matcher. That is, comparator
 * implementations can assume that the client tuples match the specified server
 * tuple.
 *
 * Matchers and comparators are always paired together. For example,
 * mediaRangeValueMatch() and mediaRangeValueCompare() are always used
 * together. These pairs are used to implement semantics reuqired for different
 * headers, e.g. processing Accept uses mediaRangeValue{Match,Compare} while,
 * processing Accept-Encoding uses wildcard{Match,Compare}.
 */

/*
 * Matcher and comparator for parameters.
 *
 * These aren't directly, but is instead used by other matchers/comparators to
 * handle parameters.
 */
const parameterMatch = (st, ct) => {
    const sp = st.properties;
    const cp = ct.properties;

    for (const [spn, spv] of sp) {
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

    for (const [cpn, cpv] of cp) {
        if (cpn !== 'q' && !sp.has(cpn)) {
            return false;
        }
    }

    return true;
};
exports.parameterMatch = parameterMatch;

const parameterCompare = (st, at, bt) => {
    const sp = st.properties;
    const ap = at.properties;
    const bp = bt.properties;

    /*
     * Count the number of non 'q' parameters that each of the client
     * parameters has in common with the server parameters.
     */
    const acnt = Array.from(ap.keys()).filter((k) => { return k !== 'q' && sp.has(k); }).length;
    const bcnt = Array.from(bp.keys()).filter((k) => { return k !== 'q' && sp.has(k); }).length;
    if (acnt !== bcnt) {
        return bcnt - acnt;
    }

    return bt.q - at.q;
};
exports.parameterCompare = parameterCompare;

/*
 * Matcher and comparator for wildcards.
 *
 * For example, 'a' and '*' should match, but 'a' and 'b' should not. Wildcard
 * matches should take lower precedence than exact matches. This is used when
 * performing negotiation on the Accept-Encoding header.
 */
const wildcardValueMatch = (st, ct) => {
    if (st.value !== ct.value && ct.value !== '*') {
        return false;
    }

    return parameterMatch(st, ct);
};
exports.wildcardValueMatch = wildcardValueMatch;

const wildcardValueCompare = (st, at, bt) => {
    if (at.value === '*' || bt.value === '*') {
        if (at.value === '*' && bt.value === '*') {
            return parameterCompare(st, at, bt);
        } else if (at.value === '*') {
            return 1;
        } else {
            return -1;
        }
    }

    return parameterCompare(st, at, bt);
};
exports.wildcardValueCompare = wildcardValueCompare;

/*
 * Matcher and comparator for media ranges.
 *
 * For example, 'text/plain' and 'text/*' should match, but 'text/plain' and
 * 'text/javascript' should not. Wildcard matches should take lower precedence
 * than exact matches. This is used when performing negotiation on the Accept
 * header.
 */
const mediaRangeValueMatch = (st, ct) => {
    const sTypes = st.value.split('/');
    const cTypes = ct.value.split('/');

    return wildcardValueMatch(
            new ValueTuple(sTypes[0], EMPTY_MAP),
            new ValueTuple(cTypes[0], EMPTY_MAP)) &&
        wildcardValueMatch(
            new ValueTuple(sTypes[1], st.properties),
            new ValueTuple(cTypes[1], ct.properties));
};
exports.mediaRangeValueMatch = mediaRangeValueMatch;

const mediaRangeValueCompare = (st, at, bt) => {
    const aTypes = at.value.split('/');
    const bTypes = bt.value.split('/');

    const c = wildcardValueCompare(
        new ValueTuple(st.value, EMPTY_MAP),
        new ValueTuple(aTypes[0], EMPTY_MAP),
        new ValueTuple(bTypes[0], EMPTY_MAP));
    if (c !== 0) {
        return c;
    }

    return wildcardValueCompare(
        st,
        new ValueTuple(aTypes[1], at.properties),
        new ValueTuple(bTypes[1], bt.properties));
};
exports.mediaRangeValueCompare = mediaRangeValueCompare;

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
const splitHeaderValue = (header) => {
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
const parseValueTuple = (v) => {
    let params = new Map();

    const s = v.split(';');
    if (s.length > 0) {
        s.forEach((av, idx) => {
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
 * Perform generic content negotiation.
 *
 * Given sorted arrays of supported (value name, q-value) tuples, determine the
 * ordered priority list of acceptable tuples. Returns an empty array is
 * nothing could be found.
 *
 * Typical applications should not call this directly.
 */
const performNegotiation = (clientValues, serverValues, matcher, comparator) => {
    let scores = [];
    serverValues.forEach((sv) => {
        /* Get all client values that match the given server value */
        const matchingCv = clientValues.filter((cv) => { return matcher(sv, cv); });
        if (matchingCv.length === 0) {
            return;
        }

        /* Pick the most specific client value */
        const cv = matchingCv
            .sort((a, b) => { return comparator(sv, a, b); })[0];

        const score = cv.q * sv.q;
        if (score <= 0) {
            return;
        }

        /* Push the server value here as it's expected not to be a wildcard */
        scores.push(
            new ValueTuple(
                sv.value,
                new Map(sv.properties),
                score));
    });

    return scores.sort((a, b) => { return b.score - a.score; });
};
exports.performNegotiation = performNegotiation;

/*
 * Perform content negotiation based on the Accept-Encoding input header.
 *
 * This is a high-level wrapper around the rest of the functions in this file.
 * Call this after converting the input Accept-Encoding header (if any) to an
 * array of ValueTuples. This array should be empty if no Accept-Encoding
 * header could be found.
 *
 * Typical applications should not call this directly.
 */
const performEncodingNegotiation = (clientValues, serverValues) => {
    const IDENTITY = new ValueTuple('identity', new Map([['q', 1]]));

    /*
     * No client values at all means the client will accept anything. Pick the
     * highest-scoring server value and go with that.
     */
    if (clientValues.length === 0) {
        let sv = Array
            .from(serverValues)
            .sort((a, b) => { return a.q - b.q; })
            .pop();
        sv.score = sv.q;
        return sv;
    }

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
    if (!clientValues.some((v) => { return wildcardValueMatch(IDENTITY, v); })) {
        clientValues.unshift(IDENTITY);
    }

    const negotiatedValues = performNegotiation(
        clientValues,
        serverValues,
        wildcardValueMatch,
        wildcardValueCompare);

    return (negotiatedValues.length == 0) ? null : negotiatedValues[0];
};
exports.performEncodingNegotiation = performEncodingNegotiation;

/*
 * Perform content negotiation based on the Accept input header.
 *
 * This is a high-level wrapper around the rest of the functions in this file.
 * Call this after converting the input Accept header (if any) to an array of
 * ValueTuples. This array should be empty if no Accept header could be found.
 *
 * Typical applications should not call this directly.
 */
const performTypeNegotiation = (clientValues, serverValues) => {
    if (clientValues.length === 0) {
        clientValues = [new ValueTuple('*/*')];
    }

    /*
     * Parse values and attributes
     *
     * Here, we adopt some heuritics from
     * https://httpd.apache.org/docs/current/content-negotiation.html#better
     * and default to small qvalues for wildcards that do not have one
     * explicitly specified. We only do this if no q-values have been
     * specified at all.
     */
    if (!clientValues.some((vt) => { return vt.properties.has('q'); })) {
        clientValues = clientValues.map((vt) => {
            if (vt.properties.has('q')) {
                return vt;
            }

            const [type, subtype] = vt.value.split('/');
            if (type !== '*' && subtype !== '*') {
                return vt;
            }

            vt.properties.set('q', (type === '*') ? 0.01 : 0.02);
            return vt;
        });
    }

    const negotiatedValues = performNegotiation(
        clientValues,
        serverValues,
        mediaRangeValueMatch,
        mediaRangeValueCompare);

    return (negotiatedValues.length == 0) ? null : negotiatedValues[0];
};
exports.performTypeNegotiation = performTypeNegotiation;

/*
 * Split headers from AWS input.
 *
 * This differs from splitHeaderValue in that it accepts AWS header object as
 * input and handles merging multiple instances of a single header.
 */
const awsSplitHeaderValue = (headers) => {
    return headers.map((ho) => { return ho['value']; })
        .reduce((a, v) => { return a.concat(splitHeaderValue(v)); }, []);
};
exports.awsSplitHeaderValue = awsSplitHeaderValue;

/*
 * AWS wrapper around performEncodingNegotiation().
 */
const awsPerformEncodingNegotiation = (headers, serverValues) => {
    return performEncodingNegotiation(
        ('accept-encoding' in headers) ?
            awsSplitHeaderValue(headers['accept-encoding'])
                .map(parseValueTuple) :
            [],
        serverValues);
};
exports.awsPerformEncodingNegotiation = awsPerformEncodingNegotiation;

/*
 * AWS wrapper around performTypeNegotiation().
 */
const awsPerformTypeNegotiation = (headers, serverValues) => {
    return performTypeNegotiation(
        ('accept' in headers) ?
            awsSplitHeaderValue(headers['accept'])
                .map(parseValueTuple) :
            [],
        serverValues);
};
exports.awsPerformTypeNegotiation = awsPerformTypeNegotiation;
