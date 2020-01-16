'use strict';

const {
    awsSplitHeaderValue,
    awsPerformTypeNegotiation,
    performNegotiation,
    performEncodingNegotiation,
    performTypeNegotiation,
    performTypemapNegotiation,
    parseValueTuple,
    splitHeaderValue,
    mediaRangeValueMatch,
    mediaRangeValueCompare,
    parameterMatch,
    parameterCompare,
    TypeMapEntry,
    typemapParse,
    wildcardValueMatch,
    wildcardValueCompare,
    ValueTuple } = require('../index.js');
const { deepStrictEqual, equal, notEqual, ok } = require('assert');

/*
 * Helper to create a Map from an Object.
 */
const createMap = (object) => {
    if (object === null || object === undefined) {
        object = {};
    }

    return new Map(Object.entries(object));
};

/*
 * Helper to create value properties.
 */
const VP = createMap;

/*
 * Helper to construct a ValueTuple from an Object
 */
const VT = (value, object, score) => {
    return new ValueTuple(value, VP(object), score);
};

/*
 * Helper to create a negotiation result returned from performNegotiation().
 */
const NR = (sv, cv, score) => {
    if (score === undefined) {
        score = sv.q * cv.q;
    }

    return { server: sv, client: cv, score: score };
}

/*
 * Helper to create a TypeMapEntry from an Object.
 */
const TME = (uri, headersObject) => {
    return new TypeMapEntry(uri, createMap(headersObject));
};

describe('splitHeaderValue()', () => {
    it('should split a simple single header', () => {
        deepStrictEqual(splitHeaderValue('a, b, c'), ['a', 'b', 'c']);
    });
    it('should strip optional whitespace', () => {
        deepStrictEqual(splitHeaderValue('a , b,c '), ['a', 'b', 'c']);
    });
    it('should not be confused by / characters', () => {
        deepStrictEqual(splitHeaderValue('image/a, image/b'), ['image/a', 'image/b']);
    });
    it('should not be confused by * characters', () => {
        deepStrictEqual(splitHeaderValue('image/*, */*'), ['image/*', '*/*']);
    });
});

describe('parseValueTuple()', () => {
    it('should handle items with no attributes', () => {
        deepStrictEqual(parseValueTuple('foo'), VT('foo'));
    });
    it('should parse multiple attributes with values', () => {
        deepStrictEqual(
            parseValueTuple('foo;a=1;b=2'),
            VT('foo', {a: '1', b: '2'}));
    });
    it('should handle attributes after wildcards', () => {
        deepStrictEqual(
            parseValueTuple('image/*;a=1;b=2'),
            VT('image/*', {a: '1', b: '2'}));
    });
    it('should not override an explicitly specified q parameter', () => {
        deepStrictEqual(
            parseValueTuple('image/*;a=1;b=2;q=0.25'),
            VT('image/*', {a: '1', b: '2', q: 0.25}));
    });
});

describe('performNegotiation()', () => {
    it('should select the common value', () => {
        const cv = [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 1})];
        const sv = [VT('c', {q: 1}), VT('z', {q: 1})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            [NR(sv[0], cv[2], 1)]);
    });
    it('should fail if there are no common values', () => {
        const cv = [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 1})];
        const sv = [VT('z', {q: 1})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            []);
    });
    it('should take client weights into account', () => {
        const cv = [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 0.8})];
        const sv = [VT('b', {q: 0.9}), VT('c', {q: 1})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            [NR(sv[0], cv[1], 0.9), NR(sv[1], cv[2], 0.8)]);
    });
    it('should take server weights into account', () => {
        const cv = [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 1})];
        const sv = [VT('b', {q: 0.9}), VT('c', {q: 1})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            [NR(sv[1], cv[2], 1), NR(sv[0], cv[1], 0.9)]);
    });
    it('should consider 0-weights as a non-match', () => {
        const cv = [VT('a', {q: 1})];
        const sv = [VT('a', {q: 0})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            []);
    });
    it('should support wildcard matching', () => {
        const cv = [VT('a', {q: 1}), VT('*', {q: 0.5})];
        const sv = [VT('a', {q: 0.25}), VT('b', {q: 1})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            [NR(sv[1], cv[1], 0.5), NR(sv[0], cv[0], 0.25)]);
    });
    it('should not apply wildcard to earlier values', () => {
        const cv = [VT('a', {q: 1}), VT('*', {q: 0.5})];
        const sv = [VT('a', {q: 0.8}), VT('b', {q: 1})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            [NR(sv[0], cv[0], 0.8), NR(sv[1], cv[1], 0.5)]);
    });
    it('should pass server parameters through to negotiated result', () => {
        const cv = [VT('a'), VT('b'), VT('*', {q: 0.5})];
        const sv = [VT('a', {q: 0.8}), VT('b', {z: 'yabba'})];

        deepStrictEqual(
            performNegotiation(
                cv,
                sv,
                wildcardValueMatch,
                wildcardValueCompare),
            [NR(sv[1], cv[1], 1), NR(sv[0], cv[0], 0.8)]);
    });
});

describe('parameterMatch()', () => {
    it('should match on exact parameters', () => {
        ok(parameterMatch(VT('a', {a: '1', b: '2'}), VT('a', {a: '1', b: '2'})));
    });
    it('should not match on subset of client parameters', () => {
        ok(!parameterMatch(VT('a', {a: '1'}), VT('a', {a: '1', b: '2'})));
    });
    it('should match on superset of client parameters', () => {
        ok(parameterMatch(VT('a', {a: '1', b: '2'}), VT('a', {a: '1'})));
    });
    it('should ignore q attribute from server', () => {
        ok(parameterMatch(VT('a', {a: '1', b: '2', q: 3}), VT('a', {a: '1', b: '2'})));
    });
    it('should ignore q attribute from client', () => {
        ok(parameterMatch(VT('a', {a: '1', b: '2'}), VT('a', {a: '1', b: '2', q: 3})));
    });
    it('should ignore mismached q attributes', () => {
        ok(parameterMatch(VT('a', {a: '1', b: '2', q: 4}), VT('a', {a: '1', b: '2', q: 3})));
    });
});

describe('parameterCompare()', () => {
    it('should prefer more specific matches', () => {
        ok(parameterCompare(VT('a', {a: '1', b: '2'}), VT('a', {a: '1'}), VT('a')) < 0);
        ok(parameterCompare(VT('a', {a: '1', b: '2'}), VT('a'), VT('a', {a: '1'})) > 0);
    });
    it('should consider equal number of matched parameters equivalent', () => {
        equal(parameterCompare(VT('a', {a: '1', b: '2'}), VT('a', {a: '1'}), VT('a', {b: '2'})), 0);
        equal(parameterCompare(VT('a', {a: '1', b: '2'}), VT('a'), VT('a')), 0);
    });
    it('should fall back to qvalues', () => {
        ok(parameterCompare(VT('a', {a: '1'}), VT('a'), VT('a', {q: 0.5})) < 0);
        ok(parameterCompare(VT('a', {a: '1'}), VT('a'), VT('a', {q: 2})) > 0);
    });
});

describe('wildcardValueMatch()', () => {
    it('should match on identical values', () => {
        ok(wildcardValueMatch(VT('a'), VT('a')));
    });
    it('should not match on different values', () => {
        ok(!wildcardValueMatch(VT('a'), VT('b')));
    });
    it('should match on client wildcard', () => {
        ok(wildcardValueMatch(VT('a'), VT('*')));
    });
    it('should not match on server wildcard', () => {
        ok(!wildcardValueMatch(VT('*'), VT('a')));
    });
    it('should use parameterMatch()', () => {
        ok(!wildcardValueMatch(VT('a'), VT('*', {a: '1'})));
        ok(wildcardValueMatch(VT('a', {a: '1'}), VT('*')));
        ok(wildcardValueMatch(VT('a'), VT('*', {q: 13})));
    });
});

describe('wildcardValueCompare()', () => {
    it('should compare wildcards after exact matches', () => {
        ok(wildcardValueCompare(VT('a'), VT('a'), VT('*')) < 0);
        ok(wildcardValueCompare(VT('a'), VT('*'), VT('a')) > 0);
    });
    it('should compare identical values to 0', () => {
        equal(wildcardValueCompare(VT('a'), VT('a'), VT('a')), 0);
        equal(wildcardValueCompare(VT('a'), VT('*'), VT('*')), 0);
    });
    it('should use parameterCompare()', () => {
        ok(wildcardValueCompare(VT('a', {a: '1'}), VT('a', {a: '1'}), VT('a')) < 0);
        ok(wildcardValueCompare(VT('a', {a: '1'}), VT('a'), VT('a', {a: '1'})) > 0);
    });
});

describe('mediaRangeValueMatch()', () => {
    it('should match on identical values', () => {
        equal(mediaRangeValueMatch(VT('a/aa'), VT('a/aa')), true);
    });
    it('should not match on different types', () => {
        equal(mediaRangeValueMatch(VT('a/aa'), VT('b/aa')), false);
    });
    it('should not match on different subtypes', () => {
        equal(mediaRangeValueMatch(VT('a/aa'), VT('a/bb')), false);
    });
    it('should match on type wildcard', () => {
        equal(mediaRangeValueMatch(VT('a/aa'), VT('*/aa')), true);
    });
    it('should match on subtype wildcard', () => {
        equal(mediaRangeValueMatch(VT('a/aa'), VT('a/*')), true);
    });
    it('should match on type and subtype wildcards', () => {
        equal(mediaRangeValueMatch(VT('a/aa'), VT('*/*')), true);
    });
    it('should use parameterMatch()', () => {
        ok(!mediaRangeValueMatch(VT('a/aa'), VT('a/aa', {a: '1'})));
        ok(mediaRangeValueMatch(VT('a/aa', {a: '1'}), VT('a/aa')));
        ok(mediaRangeValueMatch(VT('a/aa'), VT('a/aa', {q: 13})));
    });
});

describe('mediaRangeValueCompare()', () => {
    it ('should support the full matrix of wildcard positions', () => {
        equal(mediaRangeValueCompare(VT('a/aa'), VT('a/aa'), VT('a/aa')), 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('a/aa'), VT('a/*')) < 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('a/aa'), VT('*/aa')) < 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('a/aa'), VT('*/*')) < 0);

        ok(mediaRangeValueCompare(VT('a/aa'), VT('a/*'), VT('a/aa')) > 0);
        equal(mediaRangeValueCompare(VT('a/aa'), VT('a/*'), VT('a/*')), 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('a/*'), VT('*/aa')) < 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('a/*'), VT('*/*')) < 0);

        ok(mediaRangeValueCompare(VT('a/aa'), VT('*/aa'), VT('a/aa')) > 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('*/aa'), VT('a/*')) > 0);
        equal(mediaRangeValueCompare(VT('a/aa'), VT('*/aa'), VT('*/aa')), 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('*/aa'), VT('*/*')) < 0);

        ok(mediaRangeValueCompare(VT('a/aa'), VT('*/*'), VT('a/aa')) > 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('*/*'), VT('a/*')) > 0);
        ok(mediaRangeValueCompare(VT('a/aa'), VT('*/*'), VT('*/aa')) > 0);
        equal(mediaRangeValueCompare(VT('a/aa'), VT('*/*'), VT('*/*')), 0);
    });
    it('should use parameterCompare()', () => {
        ok(wildcardValueCompare(VT('a', {a: '1'}), VT('a', {a: '1'}), VT('a')) < 0);
        ok(wildcardValueCompare(VT('a', {a: '1'}), VT('a'), VT('a', {a: '1'})) > 0);
    });
});

describe('performEncodingNegotiation', () => {
    it('should return the best server value if no Accept-Encoding found', () => {
        const cv = [];
        const sv = [VT('gzip', {q: 0.5}), VT('br', {q: 1}), VT('identity', {q: 0.1})];

        // NOTE: The client match is sv[1] because of an implementation detail in
        //       performEncodingNegotiation() where we clone the server list if there
        //       is no client list. Is this behavior we want to rely on? Or should we
        //       support some mechanism to indicate that there was no client match?
        deepStrictEqual(performEncodingNegotiation(cv, sv), NR(sv[1], sv[1]));
    });
    it('implicit identity is added to client set', () => {
        const cv = [VT('qqq', {q: 0.5})];
        const sv = [VT('identity', {q: 1}), VT('gzip', {q: 1})];

        // NOTE: We're returning a reference to an internal ValueType.
        deepStrictEqual(
            performEncodingNegotiation(cv, sv),
            NR(sv[0], VT('identity', {q: 1})));
    });
    it('implicit identity is evaluated after other encodings', () => {
        const cv = [VT('gzip', {q: 0.5})];
        const sv = [VT('identity', {q: 1}), VT('gzip', {q: 1})];

        deepStrictEqual(performEncodingNegotiation(cv, sv), NR(sv[1], cv[0]));
    });
    it('should allow implicit identity value to be overridden explicitly', () => {
        const cv = [VT('gzip', {q: 0.5}), VT('identity', {q: 0})];
        const sv = [VT('identity', {q: 1}), VT('gzip', {q: 1})];

        deepStrictEqual(performEncodingNegotiation(cv, sv), NR(sv[1], cv[0]));
    });
    it('should allow implicit identity value to be overridden by wildcard', () => {
        const cv = [VT('gzip', {q: 0.5}), VT('*', {q: 0})];
        const sv = [VT('identity', {q: 1}), VT('gzip', {q: 1})];

        deepStrictEqual(performEncodingNegotiation(cv, sv), NR(sv[1], cv[0]));
    });
    it('should respect the whitelist if no Accept-Encoding found', () => {
        const cv = [];
        const sv = [VT('gzip', {q: 0.5}), VT('br', {q: 1}), VT('identity', {q: 0.1})];

        // NOTE: The client match is the server value due to implementation detail
        deepStrictEqual(
            performEncodingNegotiation(cv, sv, new Set(['gzip'])),
            NR(sv[0], sv[0]));
    });
    it('should add identity in the whitelist if no Accept-Encoding found', () => {
        const cv = [];
        const sv = [VT('gzip', {q: 0.5}), VT('br', {q: 1}), VT('identity', {q: 0.1})];

        // NOTE: The client match is the server value due to implementation detail
        deepStrictEqual(
            performEncodingNegotiation(cv, sv, new Set(['bort'])),
            NR(sv[2], sv[2]));
    });
});

describe('performTypeNegotiation', () => {
    it('should return the best server value if no Accept found', () => {
        const cv = [];
        const sv = [VT('image/webp', {q: 1}), VT('image/jpeg', {q: 0.9})];

        // NOTE: The client match is an internal value
        deepStrictEqual(performTypeNegotiation(cv, sv), NR(sv[0], VT('*/*')));
    });
    it('should prefer a more specific match', () => {
        const cv = [VT('image/webp'), VT('image/*', {q: 0.8})];
        const sv = [VT('image/webp', {q: 1.0}), VT('image/jpeg', {q: 0.9})];

        deepStrictEqual(performTypeNegotiation(cv, sv), NR(sv[0], cv[0]));
    });
    it('should fall back to wildard match', () => {
        const cv = [VT('image/webp'), VT('image/*', {q: 0.8})];
        const sv = [VT('image/bmp', {q: 0.8}), VT('image/jpeg', {q: 0.9})];

        deepStrictEqual(performTypeNegotiation(cv, sv), NR(sv[1], cv[1]));
    });
    it('should consider full wildcard as having default q=0.01', () => {
        const cv = [VT('text/plain'), VT('*/*')];

        const sv0 = [VT('text/plain', {q: 0.011}), VT('text/html')];
        deepStrictEqual(performTypeNegotiation(cv, sv0), NR(sv0[0], cv[0]));

        const sv1 = [VT('text/plain', {q: 0.009}), VT('text/html')];
        deepStrictEqual(performTypeNegotiation(cv, sv1), NR(sv1[1], cv[1]));
    });
    it('should consider subtype wildcard as having default q=0.02', () => {
        const cv = [VT('text/plain'), VT('text/*')];

        const sv0 = [VT('text/plain', {q: 0.021}), VT('text/html')];
        deepStrictEqual(
            performTypeNegotiation(cv, sv0),
            NR(sv0[0], cv[0]));

        const sv1 = [VT('text/plain', {q: 0.019}), VT('text/html')];
        deepStrictEqual(
            performTypeNegotiation(cv, sv1),
            NR(sv1[1], cv[1], 0.02));
    });
    it('should consider wildcards for low q-values if any q-values have been specified', () => {
        const cv = [VT('text/plain', {q: 1.0}), VT('*/*')];
        const sv = [VT('text/plain', {q: 0.9}), VT('text/html')];

        deepStrictEqual(performTypeNegotiation(cv, sv), NR(sv[1], cv[1]));
    });
    it('should not override explicitly-specified wildcard qvalue', () => {
        const cv = [VT('text/plain'), VT('*/*', {q: 1})];
        const sv = [VT('text/plain', {q: 0.001}), VT('text/html')];

        deepStrictEqual(performTypeNegotiation(cv, sv), NR(sv[1], cv[1]));
    });
    it('should apply a type whitelist if specified', () => {
        const cv = [VT('image/webp'), VT('image/*')];
        const sv = [VT('image/bmp', {q: 0.8}), VT('image/jpeg', {q: 0.9})];

        deepStrictEqual(
            performTypeNegotiation(cv, sv, new Set(['image/bmp'])),
            NR(sv[0], cv[1]));
        deepStrictEqual(performTypeNegotiation(cv, sv, new Set()), null);
    });
});

describe('awsSplitHeaderValue', () => {
    it('should combine and split multiple headers', () => {
        deepStrictEqual(
            awsSplitHeaderValue([
                {'key': 'Accept-Encoding', 'value': 'deflate, gzip, br'},
                {'key': 'Accept-Encoding', 'value': 'identity, deflate'}]),
            ['deflate', 'gzip', 'br', 'identity', 'deflate']
        );
    });
});

describe('awsPerformTypeNegotiation', () => {
    it('should pass rest parameters downstream', () => {
        const sv = [VT('image/bmp', {q: 0.8}), VT('image/jpeg', {q: 0.9})];

        deepStrictEqual(
            awsPerformTypeNegotiation(
                {headers: [
                    {value: 'image/webp'},
                    {value: 'image/*'}]},
                sv,
                new Set(['image/bmp'])),
            sv[0]);
    });
});

describe('typemapParse', () => {
    it('should parse a simple typemap', () => {
        const typemapContents = `
URI: document.html

Content-Language: en
Content-Type: text/html
URI: document.html.en

Content-Language: fr
Content-Type: text/html
URI: document.html.fr

Content-Language: de
Content-Type: text/html
URI: document.html.de
        `;

        const tm = typemapParse(typemapContents);
        equal(tm.length, 4);

        equal(tm[0].uri, 'document.html');
        deepStrictEqual(tm[0].headers, new Map());

        equal(tm[1].uri, 'document.html.en');
        deepStrictEqual(
            tm[1].headers,
            new Map([
                ['content-language', [VT('en')]],
                ['content-type', [VT('text/html')]],
            ])
        );

        equal(tm[2].uri, 'document.html.fr');
        equal(tm[3].uri, 'document.html.de');
    });
    it('should normalize header case', () => {
        const typemapContents = `
URI: document.html

CONTENT-language: en
CoNtEnT-tYpE: TEXT/html
URI: document.HtMl.en
        `;

        const tm = typemapParse(typemapContents);
        equal(tm.length, 2);

        equal(tm[0].uri, 'document.html');
        deepStrictEqual(tm[0].headers, new Map());

        equal(tm[1].uri, 'document.HtMl.en');
        deepStrictEqual(
            tm[1].headers,
            new Map([
                ['content-language', [VT('en')]],
                ['content-type', [VT('TEXT/html')]],
            ])
        );
    });
    it('should skip entries with no URI', () => {
        const typemapContents = `
URI: document.html

Content-Language: en
        `;

        const tm = typemapParse(typemapContents);
        equal(tm.length, 1);

        equal(tm[0].uri, 'document.html');
        deepStrictEqual(tm[0].headers, new Map());
    });
    it('should handle headers with weird structure', () => {
        const typemapContents = `
URI: u
# Extra space after header name
A    :   aaa
# Extra colons should be preserved
B: b:bb:bbb
# Empty header values should work
C:
        `;

        const tm = typemapParse(typemapContents);
        equal(tm.length, 1);

        equal(tm[0].uri, 'u');
        deepStrictEqual(tm[0].headers, createMap({
            'a': [VT('aaa')],
            'b': [VT('b:bb:bbb')],
            'c': [VT('')],
        }));
    });
    it('should drop entries with invalid headers', () => {
        const typemapContents = `
URI: u1
A

# We should require a blank line before parsing the next entry
URI: u2
A
B: b
URI: u3

URI: u4
        `;

        const tm = typemapParse(typemapContents);
        equal(tm.length, 1);

        equal(tm[0].uri, 'u4');
        deepStrictEqual(tm[0].headers, new Map());
    });
});

describe('performTypemapNegotiation', () => {
    it('should negotiate between two variants', () => {
        const tme = performTypemapNegotiation(
            createMap({
                'accept': [VT('image/*')]
            }),
            [
                TME('html', {
                    'content-type': [VT('text/html')],
                    'content-encoding': [VT('identity')]}),
                TME('jpeg', {
                    'content-type': [VT('image/jpeg')],
                    'content-encoding': [VT('identity')]})
            ],
            new Map([]),
        );
        notEqual(tme, null);
        equal(tme.uri, 'jpeg');
        deepStrictEqual(
            tme.headers,
            createMap({
                'content-type': [VT('image/jpeg')],
                'content-encoding': [VT('identity')]
            })
        );
    });
    it('should fail if no variants are acceptable', () => {
        const tme = performTypemapNegotiation(
            createMap({
                'accept': [VT('image/*')],
                'accept-encoding': [VT('gzip')],
            }),
            [
                TME('jpeg', {
                    'content-type': [VT('image/jpeg')],
                    'content-encoding': [VT('br')]}),
                TME('html', {
                    'content-type': [VT('text/html')],
                    'content-encoding': [VT('gzip')]})
            ],
            new Map([]),
        );
        equal(tme, null);
    });
    it('should select variants based on score', () => {
        const tme = performTypemapNegotiation(
            createMap({
                'accept': [VT('image/*')]
            }),
            [
                TME('gif', {
                    'content-type': [VT('image/gif', {q: 0.5})],
                    'content-encoding': [VT('identity')]}),
                TME('jpeg', {
                    'content-type': [VT('image/jpeg', {q: 0.6})],
                    'content-encoding': [VT('identity')]}),
                TME('webp', {
                    'content-type': [VT('image/webp')],
                    'content-encoding': [VT('identity')]}),
            ],
            new Map([]),
        );
        notEqual(tme, null);
        equal(tme.uri, 'webp');
        deepStrictEqual(
            tme.headers,
            createMap({
                'content-type': [VT('image/webp')],
                'content-encoding': [VT('identity')]
            })
        );
    });
});