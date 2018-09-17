var hcn = require('../http-content-negotiation.js');
var assert = require('assert');

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
            hcn.valueTuple('foo', {q: 1})
        );
    });
    it('should parse multiple attributes with values', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('foo;a=1;b=2'),
            hcn.valueTuple('foo', {q: 1, a: '1', b: '2'})
        );
    });
    it('should handle attributes after wildcards', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('image/*;a=1;b=2'),
            hcn.valueTuple('image/*', {q: 1, a: '1', b: '2'})
        );
    });
    it('should not override an explicitly specified q parameter', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('image/*;a=1;b=2;q=0.25'),
            hcn.valueTuple('image/*', {a: '1', b: '2', q: 0.25})
        );
    });
});

describe('sortHeadersbyQValue', function() {
    it('should respect q attribute values', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([hcn.valueTuple('gzip', {q: 0.25})]),
            [hcn.valueTuple('gzip', {q: 0.25})]
        );
    });
    it('should allow later items to override earlier ones', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([
                hcn.valueTuple('gzip', {q: 1}),
                hcn.valueTuple('br', {q: 0.8}),
                hcn.valueTuple('gzip', {q: 0.25})
            ]),
            [
                hcn.valueTuple('br', {q: 0.8}),
                hcn.valueTuple('gzip', {q: 0.25})
            ]
        );
    });
});

describe('performNegotiation()', function() {
    it('should select the common value', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [
                    hcn.valueTuple('a', {q: 1}),
                    hcn.valueTuple('b', {q: 1}),
                    hcn.valueTuple('c', {q: 1})
                ],
                [
                    hcn.valueTuple('c', {q: 1}),
                    hcn.valueTuple('z', {q: 1})
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
                    hcn.valueTuple('a', {q: 1}),
                    hcn.valueTuple('b', {q: 1}),
                    hcn.valueTuple('c', {q: 1})
                ],
                [
                    hcn.valueTuple('z', {q: 1})
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
                    hcn.valueTuple('a', {q: 1}),
                    hcn.valueTuple('b', {q: 1}),
                    hcn.valueTuple('c', {q: 0.8})
                ],
                [
                    hcn.valueTuple('b', {q: 0.9}),
                    hcn.valueTuple('c', {q: 1})
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
                    hcn.valueTuple('a', {q: 1}),
                    hcn.valueTuple('b', {q: 1}),
                    hcn.valueTuple('c', {q: 1})
                ],
                [
                    hcn.valueTuple('b', {q: 0.9}),
                    hcn.valueTuple('c', {q: 1})
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
                    hcn.valueTuple('a', {q: 1}),
                ],
                [
                    hcn.valueTuple('a', {q: 0}),
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
                    hcn.valueTuple('a', {q: 1}),
                    hcn.valueTuple('*', {q: 0.5})
                ],
                [
                    hcn.valueTuple('a', {q: 0.25}),
                    hcn.valueTuple('b', {q: 1})
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
                    hcn.valueTuple('a', {q: 1}),
                    hcn.valueTuple('*', {q: 0.5}),
                ],
                [
                    hcn.valueTuple('a', {q: 0.8}),
                    hcn.valueTuple('b', {q: 1})
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
                    hcn.valueTuple('a'),
                    hcn.valueTuple('a')
                ),
                true
            );
        });
        it('should not match on different values', function() {
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('b')
                ),
                false
            );
        });
        it('should not match on identical prefixes', function() {
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('ace'),
                    hcn.valueTuple('aceq')
                ),
                false
            );
        });
        it('should match on identical attributes', function() {
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('a', {a: '1', b: '2'}),
                    hcn.valueTuple('a', {a: '1', b: '2'})
                ),
                true
            );
        });
        it('should ignore q attributes', function() {
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('a', {a: '1', b: '2', q: 3}),
                    hcn.valueTuple('a', {a: '1', b: '2'})
                ),
                true
            );
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('a', {a: '1', b: '2'}),
                    hcn.valueTuple('a', {a: '1', b: '2', q: 3})
                ),
                true
            );
        });
        it('should ignore missing client parameters', function() {
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('a', {a: '1', b: '2', c: '3'}),
                    hcn.valueTuple('a', {a: '1', b: '2'})
                ),
                true
            );
        });
        it('should fail on missing server parameters', function() {
            assert.equal(
                hcn.strictValueMatch(
                    hcn.valueTuple('a', {a: '1', b: '2'}),
                    hcn.valueTuple('a', {a: '1', b: '2', c: '3'})
                ),
                false
            );
        });
        it('should compare all values to 0', function() {
            assert.equal(
                hcn.strictValueCompare(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('a')
                ),
                0
            );
        });
    });
    describe('wildcard', function() {
        it('should match on identical values', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('a')
                ),
                true
            );
        });
        it('should not match on different values', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('b')
                ),
                false
            );
        });
        it('should match on wildcards', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('*')
                ),
                true
            );
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('*'),
                    hcn.valueTuple('b')
                ),
                true
            );
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('*'),
                    hcn.valueTuple('*')
                ),
                true
            );
        });
        it('should consider attributes when matching', function() {
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('a', {a: '1', b: '2'}),
                    hcn.valueTuple('a', {a: '1', b: '2'})
                ),
                true
            );
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('a', {a: '1'}),
                    hcn.valueTuple('a', {a: '1', b: '2'})
                ),
                false
            );
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('*'),
                    hcn.valueTuple('a', {a: '1'})
                ),
                false
            );
            assert.equal(
                hcn.wildcardValueMatch(
                    hcn.valueTuple('a', {a: '1'}),
                    hcn.valueTuple('*')
                ),
                true
            );
        });
        it('should compare wildcards after exact matches', function() {
            assert.equal(
                hcn.wildcardValueCompare(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('*')
                ),
                -1
            );
            assert.equal(
                hcn.wildcardValueCompare(
                    hcn.valueTuple('*'),
                    hcn.valueTuple('a')
                ),
                1
            );
        });
        it('should compare identical values to 0', function() {
            assert.equal(
                hcn.wildcardValueCompare(
                    hcn.valueTuple('a'),
                    hcn.valueTuple('a')
                ),
                0
            );
            assert.equal(
                hcn.wildcardValueCompare(
                    hcn.valueTuple('*'),
                    hcn.valueTuple('*')
                ),
                0
            );
        });
    });
    describe('mediaRange', function() {
        it('should match on identical values', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('a/aa')
                ),
                true
            );
        });
        it('should not match on different types', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('b/aa')
                ),
                false
            );
        });
        it('should not match on different subtypes', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('a/bb')
                ),
                false
            );
        });
        it('should match on types', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('*/aa')
                ),
                true
            );
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('*/*')
                ),
                true
            );
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('*/aa'),
                    hcn.valueTuple('a/aa')
                ),
                true
            );
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('*/*'),
                    hcn.valueTuple('a/aa')
                ),
                true
            );
        });
        it('should match on subtypes', function() {
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('a/*')
                ),
                true
            );
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('*/*')
                ),
                true
            );
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('a/*'),
                    hcn.valueTuple('a/aa')
                ),
                true
            );
            assert.equal(
                hcn.mediaRangeValueMatch(
                    hcn.valueTuple('*/*'),
                    hcn.valueTuple('a/aa')
                ),
                true
            );
        });
        it('should compare wildcards after exact matches', function() {
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('a/aa')
                ),
                0
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('a/*')
                ),
                -1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('*/aa')
                ),
                -1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/aa'),
                    hcn.valueTuple('*/*')
                ),
                -1
            );

            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/*'),
                    hcn.valueTuple('a/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/*'),
                    hcn.valueTuple('a/*')
                ),
                0
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/*'),
                    hcn.valueTuple('*/aa')
                ),
                -1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('a/*'),
                    hcn.valueTuple('*/*')
                ),
                -1
            );

            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/aa'),
                    hcn.valueTuple('a/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/aa'),
                    hcn.valueTuple('a/*')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/aa'),
                    hcn.valueTuple('*/aa')
                ),
                0
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/aa'),
                    hcn.valueTuple('*/*')
                ),
                -1
            );

            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/*'),
                    hcn.valueTuple('a/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/*'),
                    hcn.valueTuple('a/*')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/*'),
                    hcn.valueTuple('*/aa')
                ),
                1
            );
            assert.equal(
                hcn.mediaRangeValueCompare(
                    hcn.valueTuple('*/*'),
                    hcn.valueTuple('*/*')
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
                    hcn.valueTuple('gzip', {q: 0.5}),
                    hcn.valueTuple('br', {q: 1}),
                    hcn.valueTuple('identity', {q: 0.1})
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
                    hcn.valueTuple('identity', {q: 1}),
                    hcn.valueTuple('gzip', {q: 1})
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
                    hcn.valueTuple('identity', {q: 1}),
                    hcn.valueTuple('gzip', {q: 1}),
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
                    hcn.valueTuple('identity', {q: 1}),
                    hcn.valueTuple('gzip', {q: 1}),
                ]
            ),
            'gzip'
        );
    });
});