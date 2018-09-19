var hcn = require('../http-content-negotiation.js');
var assert = require('assert');

/*
 * Helper to construct a ValueTuple from an Object
 */
const VT = (value, object) => {
    if (object === null || object === undefined) {
        object = {};
    }

    return new hcn.ValueTuple(value, new Map(Object.entries(object)));
};

describe('splitHeaderValue()', () => {
    it('should split a simple single header', () => {
        assert.deepStrictEqual(hcn.splitHeaderValue('a, b, c'), ['a', 'b', 'c']);
    });
    it('should strip optional whitespace', () => {
        assert.deepStrictEqual(hcn.splitHeaderValue('a , b,c '), ['a', 'b', 'c']);
    });
    it('should not be confused by / characters', () => {
        assert.deepStrictEqual(hcn.splitHeaderValue('image/a, image/b'), ['image/a', 'image/b']);
    });
    it('should not be confused by * characters', () => {
        assert.deepStrictEqual(hcn.splitHeaderValue('image/*, */*'), ['image/*', '*/*']);
    });
});

describe('parseValueTuple()', () => {
    it('should handle items with no attributes', () => {
        assert.deepStrictEqual(
            hcn.parseValueTuple('foo'),
            VT('foo', {q: 1}));
    });
    it('should parse multiple attributes with values', () => {
        assert.deepStrictEqual(
            hcn.parseValueTuple('foo;a=1;b=2'),
            VT('foo', {q: 1, a: '1', b: '2'}));
    });
    it('should handle attributes after wildcards', () => {
        assert.deepStrictEqual(
            hcn.parseValueTuple('image/*;a=1;b=2'),
            VT('image/*', {q: 1, a: '1', b: '2'}));
    });
    it('should not override an explicitly specified q parameter', () => {
        assert.deepStrictEqual(
            hcn.parseValueTuple('image/*;a=1;b=2;q=0.25'),
            VT('image/*', {a: '1', b: '2', q: 0.25}));
    });
});

describe('sortHeadersbyQValue', () => {
    it('should respect q attribute values', () => {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([VT('gzip', {q: 0.25})]),
            [VT('gzip', {q: 0.25})]);
    });
    it('should allow later items to override earlier ones', () => {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([VT('gzip', {q: 1}), VT('br', {q: 0.8}), VT('gzip', {q: 0.2})]),
            [VT('br', {q: 0.8}), VT('gzip', {q: 0.2})]);
    });
});

describe('performNegotiation()', () => {
    it('should select the common value', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 1})],
                [VT('c', {q: 1}), VT('z', {q: 1})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            VT('c', {q: 1}));
    });
    it('should fail if there are no common values', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 1})],
                [VT('z', {q: 1})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            null);
    });
    it('should take client weights into account', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 0.8})],
                [VT('b', {q: 0.9}), VT('c', {q: 1})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            VT('b', {q: 0.9}));
    });
    it('should take server weights into account', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1}), VT('b', {q: 1}), VT('c', {q: 1})],
                [VT('b', {q: 0.9}), VT('c', {q: 1})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            VT('c', {q: 1}));
    });
    it('should consider 0-weights as a non-match', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1})],
                [VT('a', {q: 0})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            null);
    });
    it('should support wildcard matching', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1}), VT('*', {q: 0.5})],
                [VT('a', {q: 0.25}), VT('b', {q: 1})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            VT('b', {q: 1}));
    });
    it('should not apply wildcard to earlier values', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a', {q: 1}), VT('*', {q: 0.5})],
                [VT('a', {q: 0.8}), VT('b', {q: 1})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            VT('a', {q: 0.8}));
    });
    it('should pass server parameters through to negotiated result', () => {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [VT('a'), VT('b'), VT('*', {q: 0.5})],
                [VT('a', {q: 0.8}), VT('b', {z: 'yabba'})],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare),
            VT('b', {z: 'yabba'}));
    });
});

describe('matchersAndComparators', () => {
    describe('wildcard', () => {
        it('should match on identical values', () => {
            assert.equal(hcn.wildcardValueMatch(VT('a'), VT('a')), true);
        });
        it('should not match on different values', () => {
            assert.equal(hcn.wildcardValueMatch(VT('a'), VT('b')), false);
        });
        it('should match on client wildcard', () => {
            assert.equal(hcn.wildcardValueMatch(VT('a'), VT('*')), true);
        });
        it('should match on exact parameters', () => {
            assert.equal(
                hcn.wildcardValueMatch(VT('a', {a: '1', b: '2'}), VT('a', {a: '1', b: '2'})), true);
        });
        it('should not match on subset of client parameters', () => {
            assert.equal(
                hcn.wildcardValueMatch(VT('a', {a: '1'}), VT('a', {a: '1', b: '2'})), false);
        });
        it('should match on superset of client parameters', () => {
            assert.equal(
                hcn.wildcardValueMatch(VT('a', {a: '1', b: '2'}), VT('a', {a: '1'})), true);
        });
        it('should ignore q attribute from server', () => {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1', b: '2', q: 3}),
                    VT('a', {a: '1', b: '2'})),
                true);
        });
        it('should ignore q attribute from client', () => {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1', b: '2'}),
                    VT('a', {a: '1', b: '2', q: 3})),
                true);
        });
        it('should ignore mismached q attributes', () => {
            assert.equal(
                hcn.wildcardValueMatch(
                    VT('a', {a: '1', b: '2', q: 4}),
                    VT('a', {a: '1', b: '2', q: 3})),
                true);
        });
        it('should match on superset of client parameters with wildcard', () => {
            assert.equal(hcn.wildcardValueMatch(VT('a', {a: '1'}), VT('*')), true);
        });
        it('should compare wildcards after exact matches', () => {
            assert.equal(hcn.wildcardValueCompare(VT('a'), VT('*')), -1);
            assert.equal(hcn.wildcardValueCompare(VT('*'), VT('a')), 1);
        });
        it('should compare identical values to 0', () => {
            assert.equal(hcn.wildcardValueCompare(VT('a'), VT('a')), 0);
            assert.equal(hcn.wildcardValueCompare(VT('*'), VT('*')), 0);
        });
    });
    describe('mediaRange', () => {
        it('should match on identical values', () => {
            assert.equal(hcn.mediaRangeValueMatch(VT('a/aa'), VT('a/aa')), true);
        });
        it('should not match on different types', () => {
            assert.equal(hcn.mediaRangeValueMatch(VT('a/aa'), VT('b/aa')), false);
        });
        it('should not match on different subtypes', () => {
            assert.equal(hcn.mediaRangeValueMatch(VT('a/aa'), VT('a/bb')), false);
        });
        it('should match on type wildcard', () => {
            assert.equal(hcn.mediaRangeValueMatch(VT('a/aa'), VT('*/aa')), true);
        });
        it('should match on subtype wildcard', () => {
            assert.equal(hcn.mediaRangeValueMatch(VT('a/aa'), VT('a/*')), true);
        });
        it('should match on type and subtype wildcards', () => {
            assert.equal(hcn.mediaRangeValueMatch(VT('a/aa'), VT('*/*')), true);
        });
        it('should compare wildcards after exact matches', () => {
            assert.equal(hcn.mediaRangeValueCompare(VT('a/aa'), VT('a/aa')), 0);
            assert.equal(hcn.mediaRangeValueCompare(VT('a/aa'), VT('a/*')), -1);
            assert.equal(hcn.mediaRangeValueCompare(VT('a/aa'), VT('*/aa')), -1);
            assert.equal(hcn.mediaRangeValueCompare(VT('a/aa'), VT('*/*')), -1);

            assert.equal(hcn.mediaRangeValueCompare(VT('a/*'), VT('a/aa')), 1);
            assert.equal(hcn.mediaRangeValueCompare(VT('a/*'), VT('a/*')), 0);
            assert.equal(hcn.mediaRangeValueCompare(VT('a/*'), VT('*/aa')), -1);
            assert.equal(hcn.mediaRangeValueCompare(VT('a/*'), VT('*/*')), -1);

            assert.equal(hcn.mediaRangeValueCompare(VT('*/aa'), VT('a/aa')), 1);
            assert.equal(hcn.mediaRangeValueCompare(VT('*/aa'), VT('a/*')), 1);
            assert.equal(hcn.mediaRangeValueCompare(VT('*/aa'), VT('*/aa')), 0);
            assert.equal(hcn.mediaRangeValueCompare(VT('*/aa'), VT('*/*')), -1);

            assert.equal(hcn.mediaRangeValueCompare(VT('*/*'), VT('a/aa')), 1);
            assert.equal(hcn.mediaRangeValueCompare(VT('*/*'), VT('a/*')), 1);
            assert.equal(hcn.mediaRangeValueCompare(VT('*/*'), VT('*/aa')), 1);
            assert.equal(hcn.mediaRangeValueCompare(VT('*/*'), VT('*/*')), 0);
        });
    });
});

describe('awsSplitHeaderValue', () => {
    it('should combine and split multiple headers', () => {
        assert.deepStrictEqual(
            hcn.awsSplitHeaderValue([
                {'key': 'Accept-Encoding', 'value': 'deflate, gzip, br'},
                {'key': 'Accept-Encoding', 'value': 'identity, deflate'}]),
            ['deflate', 'gzip', 'br', 'identity', 'deflate']
        );
    });
});

describe('awsNegotiateEncoding', () => {
    it('should return the best server value if no Accept-Encoding found', () => {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'user-agent': [{'key': 'User-Agent', 'value': 'Firefox'}]},
                [VT('gzip', {q: 0.5}), VT('br', {q: 1}), VT('identity', {q: 0.1})]),
            'br');
    });
    it('should assume an implicit identity;q=1 value', () => {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5'}]},
                [VT('identity', {q: 1}), VT('gzip', {q: 1})]),
            'identity');
    });
    it('should allow implicit identity value to be overridden explicitly', () => {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5, identity;q=0'}]},
                [VT('identity', {q: 1}), VT('gzip', {q: 1})]),
            'gzip');
    });
    it('should allow implicit identity value to be overridden by wildcard', () => {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5, *;q=0'}]},
                [VT('identity', {q: 1}), VT('gzip', {q: 1})]),
            'gzip');
    });
});