const assert = require('assert');

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
exports.splitHeaders = function(headers) {
    return headers.map(function(ho) { return ho['value']; })
        .reduce(
            function(acc, val) {
                return acc.concat(val.replace(/ +/g, '').split(','));
            },
            []);
};

/*
 * Parse an HTTP header value with optional attributes, returning a tuple of
 * (value name, attributes dictionary).
 *
 * For example 'foo;a=1;b=2' would return ['foo', {'a': 1, 'b': 2}].
 */
exports.parseHeaderValue = function(v) {
    const s = v.split(';');
    if (s.length == 1) {
        return [v, {}];
    }

    const attrs = {};
    s.forEach(function(av, idx) {
        if (idx === 0) {
            return;
        }

        const kvp = av.split('=', 2)
        attrs[kvp[0]] = kvp[1];
    });

    return [s[0], attrs];
};

/*
 * Given an array of (value name, attribute dictionary) tuples, return a sorted
 * array of (value name, q-value) tuples, ordered by the value of the 'q' attribute.
 *
 * If multiple instances of the same value are found, the last instance will
 * override attributes of the earlier values. If no 'q' attribute is specified,
 * a default value of 1 is assumed.
 *
 * For example given the below header values, the output of this function will
 * be [['b', 3], ['a', 2]].
 *
 *      [['a', {'q': '5'}], ['a', {'q': '2'}], ['b', {'q': '3'}]]
 */
exports.sortHeadersByQValue = function(headerValues) {
    /* Parse q attributes, ensuring that all to 1 */
    var headerValuesWithQValues = headerValues.map(function(vt) {
        var vn = vt[0];
        var va = vt[1];

        if ('q' in va) {
            return [vn, parseFloat(va['q'])];
        } else {
            return [vn, 1];
        }
    });

    /* Filter out duplicates by name, preserving the last seen */
    var seen = {};
    const filteredValues = headerValuesWithQValues.reverse().filter(function(vt) {
        const vn = vt[0];
        if (vn in seen) {
            return false;
        }

        seen[vn] = true;
        return true;
    });

    /* Sort by values with highest 'q' attribute */
    return filteredValues.sort(function(a, b) { return b[1] - a[1]; });
};

/*
 * Perform content negotiation.
 *
 * Given sorted arrays of supported (value name, q-value) tuples, select a
 * value that is mutuaully acceptable. Returns null is nothing could be found.
 */
exports.performNegotiation = function(clientValues, serverValues) {
    var scores = [];
    for (var i = 0; i < clientValues.length; ++i) {
        const cv = clientValues[i];
        const sv = serverValues.find(function(sv) { return sv[0] === cv[0]; });
        if (sv === undefined) {
            continue;
        }

        const score = cv[1] * sv[1];
        if (score <= 0) {
            continue;
        }

        scores.push([cv[0], score]);
    }

    if (scores.length === 0) {
        return null;
    }

    return scores.sort(function(a, b) { return b[1] - a[1]; })[0][0];
};