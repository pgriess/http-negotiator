var hcn = require('../http-content-negotiation.js');
var assert = require('assert');

/*
 * Helper to construct a ValueTuple from an Object
 */
const VT = function(value, object) {
    if (object === null || object === undefined) {
        object = {};
    }

    return new hcn.ValueTuple(value, new Map(Object.entries(object)));
};

describe('splitHeaderValue()', function() {
    it('should split a simple single header', function() {
        assert.deepStrictEqual(
            hcn.splitHeaderValue('gzip, br, identity'),
            ['gzip', 'br', 'identity']
        );
    });
    it('should strip optional whitespace', function() {
        assert.deepStrictEqual(
            hcn.splitHeaderValue('gzip , br,identity '),
            ['gzip', 'br', 'identity']
        );
    });
    it('should not be confused by / characters', function() {
        assert.deepStrictEqual(
            hcn.splitHeaderValue('image/png, image/webp'),
            ['image/png', 'image/webp']
        );
    });
    it('should not be confused by * characters', function() {
        assert.deepStrictEqual(
            hcn.splitHeaderValue('image/*, */*'),
            ['image/*', '*/*']
        );
    });
});

describe('parseHeaderValue()', function() {
    it('should handle items with no attributes', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('foo'),
            VT('foo', {q: 1})
        );
    });
    it('should parse multiple attributes with values', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('foo;a=1;b=2'),
            VT('foo', {q: 1, a: '1', b: '2'})
        );
    });
    it('should handle attributes after wildcards', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('image/*;a=1;b=2'),
            VT('image/*', {q: 1, a: '1', b: '2'})
        );
    });
    it('should not override an explicitly specified q parameter', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('image/*;a=1;b=2;q=0.25'),
            VT('image/*', {a: '1', b: '2', q: 0.25})
        );
    });
});

describe('sortHeadersbyQValue', function() {
    it('should respect q attribute values', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([VT('gzip', {q: 0.25})]),
            [VT('gzip', {q: 0.25})]
        );
    });
    it('should allow later items to override earlier ones', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([
                VT('gzip', {q: 1}),
                VT('br', {q: 0.8}),
                VT('gzip', {q: 0.25})
            ]),
            [
                VT('br', {q: 0.8}),
                VT('gzip', {q: 0.25})
            ]
        );
    });
});

describe('performNegotiation()', function() {
    it('should select the common value', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                    VT('b', {q: 1}),
                    VT('c', {q: 1})
                ],
                [
                    VT('c', {q: 1}),
                    VT('z', {q: 1})
                ],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            'c'
        );
    });
    it('should fail if there are no common values', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                    VT('b', {q: 1}),
                    VT('c', {q: 1})
                ],
                [
                    VT('z', {q: 1})
                ],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            null
        );
    });
    it('should take client weights into account', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                    VT('b', {q: 1}),
                    VT('c', {q: 0.8})
                ],
                [
                    VT('b', {q: 0.9}),
                    VT('c', {q: 1})
                ],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            'b'
        );
    });
    it('should take server weights into account', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                    VT('b', {q: 1}),
                    VT('c', {q: 1})
                ],
                [
                    VT('b', {q: 0.9}),
                    VT('c', {q: 1})
                ],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            'c'
        );
    });
    it('should consider 0-weights as a non-match', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                ],
                [
                    VT('a', {q: 0}),
                ],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            null
        );
    });
    it('should support wildcard matching', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                    VT('*', {q: 0.5})
                ],
                [
                    VT('a', {q: 0.25}),
                    VT('b', {q: 1})
                ],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare
            ),
            'b'
        );
    });
    it('should not apply wildcard to earlier values', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    VT('a', {q: 1}),
                    VT('*', {q: 0.5}),
                ],
                [
                    VT('a', {q: 0.8}),
                    VT('b', {q: 1})
                ],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare
            ),
            'a'
        );
    });
});

describe('matchersAndComparators', function() {
    describe('strict', function() {
        it('should match on identical values', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a'),
                    VT('a')
                ),
                true
            );
        });
        it('should not match on different values', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a'),
                    VT('b')
                ),
                false
            );
        });
        it('should not match on identical prefixes', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('ace'),
                    VT('aceq')
                ),
                false
            );
        });
        it('should match on identical attributes', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a', {a: '1', b: '2'}),
                    VT('a', {a: '1', b: '2'})
                ),
                true
            );
        });
        it('should ignore q attribute from server', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a', {a: '1', b: '2', q: 3}),
                    VT('a', {a: '1', b: '2'})
                ),
                true
            );
        });
        it('should ignore q attribute from client', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a', {a: '1', b: '2'}),
                    VT('a', {a: '1', b: '2', q: 3})
                ),
                true
            );
        });
        it('should ignore mismached q attributes', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a', {a: '1', b: '2', q: 4}),
                    VT('a', {a: '1', b: '2', q: 3})
                ),
                true
            );
        });
        it('should ignore missing client parameters', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a', {a: '1', b: '2', c: '3'}),
                    VT('a', {a: '1', b: '2'})
                ),
                true
            );
        });
        it('should fail on missing server parameters', function() {
            assert.equal(
                hcn.strictValueMatch(
                    VT('a', {a: '1', b: '2'}),
                    VT('a', {a: '1', b: '2', c: '3'})
                ),
                false
            );
        });
        it('should compare all values to 0', function() {
            assert.equal(
                hcn.strictValueCompare(
                    VT('a'),
                    VT('a')
                ),
                0
            );
        });
    });
    describe('wildcard', function() {
        it('should match on identical values', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a'),
                    VT('a')
                ),
                true
            );
        });
        it('should not match on different values', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a'),
                    VT('b')
                ),
                false
            );
        });
        it('should match on client wildcard', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a'),
                    VT('*')
                ),
                true
            );
        });
        it('should match on exact parameters', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1', b: '2'}),
                    VT('a', {a: '1', b: '2'})
                ),
                true
            );
        });
        it('should not match on subset of client parameters', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1'}),
                    VT('a', {a: '1', b: '2'})
                ),
                false
            );
        });
        it('should match on superset of client parameters', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1', b: '2'}),
                    VT('a', {a: '1'})
                ),
                true
            );
        });
        it('should match on superset of client parameters with wildcard', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1'}),
                    VT('*')
                ),
                true
            );
        });
        it('should compare wildcards after exact matches', function() {
            assert.equal(
                hcn.wildcardValueCompare(
                    VT('a'),
                    VT('*')
                ),
                -1
            );
            assert.equal(
                hcn.wildcardValueCompare(
                    VT('*'),
                    VT('a')
                ),
                1
            );
        });
        it('should compare identical values to 0', function() {
            assert.equal(
                hcn.wildcardValueCompare(
                    VT('a'),
                    VT('a')
                ),
                0
            );
            assert.equal(
                hcn.wildcardValueCompare(
                    VT('*'),
                    VT('*')
                ),
                0
            );
        });
    });
    describe('mediaRange', function() {
        it('should match on identical values', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    VT('a/aa'),
                    VT('a/aa')
                ),
                true
            );
        });
        it('should not match on different types', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    VT('a/aa'),
                    VT('b/aa')
                ),
                false
            );
        });
        it('should not match on different subtypes', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    VT('a/aa'),
                    VT('a/bb')
                ),
                false
            );
        });
        it('should match on type wildcard', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    VT('a/aa'),
                    VT('*/aa')
                ),
                true
            );
        });
        it('should match on subtype wildcard', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    VT('a/aa'),
                    VT('a/*')
                ),
                true
            );
        });
        it('should match on type and subtype wildcards', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    VT('a/aa'),
                    VT('*/*')
                ),
                true
            );
        });
        it('should compare wildcards after exact matches', function() {
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/aa'),
                    VT('a/aa')
                ),
                0
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/aa'),
                    VT('a/*')
                ),
                -1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/aa'),
                    VT('*/aa')
                ),
                -1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/aa'),
                    VT('*/*')
                ),
                -1
            );

            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/*'),
                    VT('a/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/*'),
                    VT('a/*')
                ),
                0
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/*'),
                    VT('*/aa')
                ),
                -1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('a/*'),
                    VT('*/*')
                ),
                -1
            );

            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/aa'),
                    VT('a/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/aa'),
                    VT('a/*')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/aa'),
                    VT('*/aa')
                ),
                0
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/aa'),
                    VT('*/*')
                ),
                -1
            );

            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/*'),
                    VT('a/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/*'),
                    VT('a/*')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/*'),
                    VT('*/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    VT('*/*'),
                    VT('*/*')
                ),
                0
            );
        });
    });
});

describe('awsSplitHeaderValue', function() {
    it('should combine and split multiple headers', function() {
        assert.deepStrictEqual(
            hcn.awsSplitHeaderValue([
                {'key': 'Accept-Encoding', 'value': 'deflate, gzip, br'},
                {'key': 'Accept-Encoding', 'value': 'identity, deflate'}]),
            ['deflate', 'gzip', 'br', 'identity', 'deflate']
        );
    });
});

describe('awsNegotiateEncoding', function() {
    it('should return the best server value if no Accept-Encoding found', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'user-agent': [{'key': 'User-Agent', 'value': 'Firefox'}]},
                [
                    VT('gzip', {q: 0.5}),
                    VT('br', {q: 1}),
                    VT('identity', {q: 0.1})
                ]
            ),
            'br'
        );
    });
    it('should assume an implicit identity;q=1 value', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5'}]},
                [
                    VT('identity', {q: 1}),
                    VT('gzip', {q: 1})
                ]
            ),
            'identity'
        );
    });
    it('should allow implicit identity value to be overridden explicitly', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5, identity;q=0'}]},
                [
                    VT('identity', {q: 1}),
                    VT('gzip', {q: 1}),
                ]
            ),
            'gzip'
        );
    });
    it('should allow implicit identity value to be overridden by wildcard', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5, *;q=0'}]},
                [
                    VT('identity', {q: 1}),
                    VT('gzip', {q: 1}),
                ]
            ),
            'gzip'
        );
    });
});