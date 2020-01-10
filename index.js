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
 */
const ValueTuple = class {
    constructor(value, properties) {
        this.value = value;
        this.properties = properties || new Map();
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
        scores.push({ server: sv, client: cv, score: score });
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
const performEncodingNegotiation = (clientValues, serverValues, whitelist) => {
    const IDENTITY = new ValueTuple('identity', new Map([['q', 1]]));
    const hasIdentity = clientValues.some((v) => {
        return wildcardValueMatch(IDENTITY, v); }
    );

    /*
     * From RFC7231 5.3.4, no client value at all means they will accept
     * anything. Use the server's values here so that we can go through the
     * normal flow below.
     * 
     * NOTE: We must apply a whitelist here, as without this we may end
     *       up using a Content-Encoding that the client is un-prepared
     *       for. While this is spec-compliant behavior it breaks in
     *       practice for more novel Content-Encodings, e.g. br.
     */
    if (clientValues.length === 0) {
        clientValues = serverValues.filter((v) => {
            return !whitelist ||
                v.value === 'identity' ||
                whitelist.has(v.value)
        });
    }

    let negotiatedValues = performNegotiation(
        clientValues,
        serverValues,
        wildcardValueMatch,
        wildcardValueCompare);

    /*
     * If we got no results and the client didn't specify 'identity', try again
     * with it as a default option per RFC 7231 section 5.3.4.
     *
     * The RFC does not specify a default weight. If we picked one, and folded
     * this into the first negotiation pass we might end up preferring it to
     * something else. Instead, wait until we've failed to match anything and
     * then try again with it by itself.
     */
    if (negotiatedValues.length === 0 && !hasIdentity) {
        negotiatedValues = performNegotiation(
            [IDENTITY],
            serverValues,
            wildcardValueMatch,
            wildcardValueCompare);
    }

    return (negotiatedValues.length == 0) ? null : negotiatedValues[0].server;
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
const performTypeNegotiation = (clientValues, serverValues, whitelist) => {
    /*
     * From RFC7231 5.3.2 -- "A request without any Accept header field implies
     * that the user agent will accept any media type in response."
     */
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
    let comparator = mediaRangeValueCompare;
    if (!clientValues.some((vt) => { return vt.properties.has('q'); })) {
        let transform = (vt) => {
            if (vt.properties.has('q')) {
                return vt;
            }

            const [type, subtype] = vt.value.split('/');
            if (type !== '*' && subtype !== '*') {
                return vt;
            }

            let props = vt.properties;
            props.set('q', (type === '*') ? 0.01 : 0.02);

            return new ValueTuple(vt.value, props);
        };
        comparator = (st, at, bt) => {
            return mediaRangeValueCompare(st, transform(at), transform(bt));
        };
    }

    let negotiatedValues = performNegotiation(
        clientValues,
        serverValues,
        mediaRangeValueMatch,
        comparator);

    /*
     * Filter out any server values that matched client wildcards unless they
     * are in the whitelist.
     */
    if (whitelist) {
        negotiatedValues = negotiatedValues.filter((nv) => {
            const [type, subtype] = nv.client.value.split('/');
            if (type !== '*' && subtype !== '*') {
                return true;
            }

            return whitelist.has(nv.server.value)
        });
    }

    return (negotiatedValues.length == 0) ? null : negotiatedValues[0].server;
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
 *
 * TODO: RFC 7231 Section 5.3.4 states that we should treat a missing
 *       Accept-Encoding header as "accept anything", but an empty header
 *       as "accept nothing". Right now we are collapsing both cases to
 *       an empty list when invoking performEncodingNegotiation(). We should
 *       probably seprate them, e.g. by using null or undefined.
 */
const awsPerformEncodingNegotiation = (headers, serverValues, ...rest) => {
    return performEncodingNegotiation(
        ('accept-encoding' in headers) ?
            awsSplitHeaderValue(headers['accept-encoding'])
                .map(parseValueTuple) :
            [],
        serverValues,
        ...rest);
};
exports.awsPerformEncodingNegotiation = awsPerformEncodingNegotiation;

/*
 * AWS wrapper around performTypeNegotiation().
 *
 * TODO: Same empty vs missing header handling as as
 *       awsPerformEncodingNegotiation.
 */
const awsPerformTypeNegotiation = (headers, serverValues, ...rest) => {
    return performTypeNegotiation(
        ('accept' in headers) ?
            awsSplitHeaderValue(headers['accept'])
                .map(parseValueTuple) :
            [],
        serverValues,
        ...rest);
};
exports.awsPerformTypeNegotiation = awsPerformTypeNegotiation;

/*
 * A single entry in a typemap file.
 *
 * A typemap is used to define different representations of the same content,
 * and the server parameters to use for negotiation. The idea is that a static
 * typemap can be used in lieu of writing code to define the server's
 * preferences. This facilitates a single universal content negotiation
 * algorithm to execute based on server data from a typemap and client data
 * from the HTTP headers.
 * 
 * The concept of a type map and the syntax is defined by the
 * Apache webserver documentation at
 * 
 *  https://httpd.apache.org/docs/current/mod/mod_negotiation.html#typemaps
 */
const TypeMapEntry = class {
    constructor(uri, headers) {
        this.uri = uri;
        this.headers = headers || new Map();
    }
};
exports.TypeMapEntry = TypeMapEntry;

/*
 * Parse a string into an array of TypeMapEntry objects.
 *
 * TODO: What is the order on which we should perform negotiation? Do we prefer
 *       encoding over type, etc? There must be an RFC for this, right?
 * 
 * TODO: Should we support 'qs' as a synonym for 'q'. That is what the Apache
 *       typemap spec indiciates.
 * 
 * TODO: Write an aws* wrapper for negotiation across all indices.
 * 
 * TODO: Drop subsequent instances of the same URI? Return a map?
 */
const typemapParse = (str) => {
    const lines = str.split(/\n/);

    let types = [];
    let entry = undefined;
    let entryBad = false;

    const maybeFlushEntry = () => {
        if (!entryBad && entry && entry.uri && entry.uri.length > 0) {
            types.push(entry);
        }

        entry = undefined;
        entryBad = false;
    };

    for (let i = 0; i < lines.length; ++i) {
        const l = lines[i].trim();

        // Skip comments
        if (l[0] == '#') {
            continue;
        }

        // An empty lines indicates the end of an entry; flush it
        if (l.length == 0) {
            maybeFlushEntry();
            continue;
        }

        if (!entry) {
            entry = new TypeMapEntry();
        }

        const splitIndex = l.indexOf(':');
        if (splitIndex == -1) {
            entryBad = true;
            continue;
        }

        const hv = l.substr(splitIndex + 1).trim();
        const hn = l.substr(0, splitIndex).trim().toLowerCase();

        if (hn == 'uri') {
            entry.uri = hv.trim();
        } else {
            entry.headers.set(hn, splitHeaderValue(hv).map(parseValueTuple));
        }
    }

    // EOF indicates the end of the last entry as well; flush it
    maybeFlushEntry();

    return types;
};
exports.typemapParse = typemapParse;

/*
 * Perform content negotiation based on client headers and a server typemap.
 *
 * clientHeaderMap is a Map of header names to an array of ValueTuples.
 * serverTypemap is an array of TypeMapEntry objects
 * whitelistMap is a Map of header names to a Set of string values
 */
const performTypemapNegotiation = (clientHeaderMap, serverTypemap, whitelistMap) => {
    /* Negotiate Content-Type */
    const clientAcceptValues = clientHeaderMap.has('accept') ? clientHeaderMap.get('accept') : []

    // XXX: What do we do with no whitelist? Should we return a 406?
    const whitelistAcceptValues = whitelistMap.has('accept') ? whitelistMap.get('accept') : null;

    /*
     * Filter out entries from the server typemap that do not match
     *
     * XXX: Rather than filtering, we should be accumulating a score so that at the end
     *      of our runs, we can pick the alternative which is best suited given all of
     *      the constraints. Right now, we can only pick a representation which is not
     *      illegal.
     */
    serverTypemap = serverTypemap.filter((tme) => {
        const serverAcceptValues = (tme.headers.has('content-type')) ? tme.headers.get('content-type') : [];
        // XXX: How does performNegotiation handle an empty server list?
        const sco = performTypeNegotiation(clientAcceptValues, serverAcceptValues, whitelistAcceptValues);
        return sco != null;
    })

    return (serverTypemap.length == 0) ? null : serverTypemap[0];
};
exports.performTypemapNegotiation = performTypemapNegotiation;