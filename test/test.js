var hcn = require('../http-content-negotiation.js');
var assert = require('assert');

describe('splitHeaders()', function() {
    it('should split a simple single header', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept-Encoding', 'value': 'gzip, br, identity'}]),
            ['gzip', 'br', 'identity']
        );
    });
    it('should combine and split multiple headers', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept-Encoding', 'value': 'deflate, gzip, br'},
                {'key': 'Accept-Encoding', 'value': 'identity, deflate'}]),
            ['deflate', 'gzip', 'br', 'identity', 'deflate']
        );
    });
    it('should strip optional whitespace', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept-Encoding', 'value': 'gzip , br,identity '}]),
            ['gzip', 'br', 'identity']
        );
    });
    it('should not be confused by / characters', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept', 'value': 'image/png, image/webp'}]),
            ['image/png', 'image/webp']
        );
    });
    it('should not be confused by * characters', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept', 'value': 'image/*, */*'}]),
            ['image/*', '*/*']
        );
    });
});

describe('parseHeaderValue()', function() {
    it('should handle items with no attributes', function() {
        assert.deepStrictEqual(hcn.parseHeaderValue('foo'), ['foo', {}]);
    });
    it('should parse multiple attributes with values', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('foo;a=1;b=2'),
            ['foo', {'a': '1', 'b': '2'}]
        );
    });
    it('should handle attributes after wildcards', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('image/*;a=1;b=2'),
            ['image/*', {'a': '1', 'b': '2'}]
        );
    });
});

describe('sortHeadersbyQValue', function() {
    it('should respect q attribute values', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([['gzip', {'q': '0.25'}]]),
            [['gzip', 0.25]]
        );
    });
    it('should infer a q attribute value of 1 if un-specified', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([['gzip', {}]]),
            [['gzip', 1]]
        );
    });
    it('should allow later items to override earlier ones', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([
                ['gzip', {}],
                ['br', {'q': '0.8'}],
                ['gzip', {'q': '0.25'}],
            ]),
            [['br', 0.8], ['gzip', 0.25]]
        );
    });
});

describe('performNegotiation()', function() {
    it('should select the common value', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 1]],
                [['c', 1], ['z', 1]],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            'c'
        );
    });
    it('should fail if there are no common values', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 1]],
                [['z', 1]],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            null
        );
    });
    it('should take client weights into account', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 0.8]],
                [['b', 0.9], ['c', 1]],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            'b'
        );
    });
    it('should take server weights into account', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 1]],
                [['b', 0.9], ['c', 1]],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            'c'
        );
    });
    it('should consider 0-weights as a non-match', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1]],
                [['a', 0]],
                hcn.strictValueMatch,
                hcn.strictValueCompare
            ),
            null
        );
    });
    it('should support wildcard matching', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['*', 0.5]],
                [['a', 0.25], ['b', 1]],
                hcn.wildcardValueMatch,
                hcn.wildcardValueCompare
            ),
            'b'
        );
    });
    it('should not apply wildcard to earlier values', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['*', 0.5]],
                [['a', 0.8], ['b', 1]],
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
            assert.equal(hcn.strictValueMatch('a', 'a'), true);
        });
        it('should not match on different values', function() {
            assert.equal(hcn.strictValueMatch('a', 'b'), false);
        });
        it('should not match on identical prefixes', function() {
            assert.equal(hcn.strictValueMatch('ace', 'aceq'), false);
        });
        it('should compare all values to 0', function() {
            assert.equal(hcn.strictValueCompare('a', 'a'), 0);
            assert.equal(hcn.strictValueCompare('a', 'b'), 0);
        });
    });
    describe('wildcard', function() {
        it('should match on identical values', function() {
            assert.equal(hcn.wildcardValueMatch('a', 'a'), true);
        });
        it('should not match on different values', function() {
            assert.equal(hcn.wildcardValueMatch('a', 'b'), false);
        });
        it('should match on wildcards', function() {
            assert.equal(hcn.wildcardValueMatch('a', '*'), true);
            assert.equal(hcn.wildcardValueMatch('*', 'b'), true);
            assert.equal(hcn.wildcardValueMatch('*', '*'), true);
        });
        it('should compare wildcards after exact matches', function() {
            assert.equal(hcn.wildcardValueCompare('a', '*'), -1);
            assert.equal(hcn.wildcardValueCompare('*', 'a'), 1);
        });
        it('should compare identical values to 0', function() {
            assert.equal(hcn.wildcardValueCompare('a', 'a'), 0);
            assert.equal(hcn.wildcardValueCompare('*', '*'), 0);
        });
    });
    describe('mediaRange', function() {
        it('should match on identical values', function() {
            assert.equal(hcn.mediaRangeValueMatch('a/aa', 'a/aa'), true);
        });
        it('should not match on different types', function() {
            assert.equal(hcn.mediaRangeValueMatch('a/aa', 'b/aa'), false);
        });
        it('should not match on different subtypes', function() {
            assert.equal(hcn.mediaRangeValueMatch('a/aa', 'a/bb'), false);
        });
        it('should match on types', function() {
            assert.equal(hcn.mediaRangeValueMatch('a/aa', '*/aa'), true);
            assert.equal(hcn.mediaRangeValueMatch('a/aa', '*/*'), true);
            assert.equal(hcn.mediaRangeValueMatch('*/aa', 'a/aa'), true);
            assert.equal(hcn.mediaRangeValueMatch('*/*', 'a/aa'), true);
        });
        it('should match on subtypes', function() {
            assert.equal(hcn.mediaRangeValueMatch('a/aa', 'a/*'), true);
            assert.equal(hcn.mediaRangeValueMatch('a/aa', '*/*'), true);
            assert.equal(hcn.mediaRangeValueMatch('a/*', 'a/aa'), true);
            assert.equal(hcn.mediaRangeValueMatch('*/*', 'a/aa'), true);
        });
        it('should compare wildcards after exact matches', function() {
            assert.equal(hcn.mediaRangeValueCompare('a/aa', 'a/aa'), 0);
            assert.equal(hcn.mediaRangeValueCompare('a/aa', 'a/*'), -1);
            assert.equal(hcn.mediaRangeValueCompare('a/aa', '*/aa'), -1);
            assert.equal(hcn.mediaRangeValueCompare('a/aa', '*/*'), -1);

            assert.equal(hcn.mediaRangeValueCompare('a/*', 'a/aa'), 1);
            assert.equal(hcn.mediaRangeValueCompare('a/*', 'a/*'), 0);
            assert.equal(hcn.mediaRangeValueCompare('a/*', '*/aa'), -1);
            assert.equal(hcn.mediaRangeValueCompare('a/*', '*/*'), -1);

            assert.equal(hcn.mediaRangeValueCompare('*/aa', 'a/aa'), 1);
            assert.equal(hcn.mediaRangeValueCompare('*/aa', 'a/*'), 1);
            assert.equal(hcn.mediaRangeValueCompare('*/aa', '*/aa'), 0);
            assert.equal(hcn.mediaRangeValueCompare('*/aa', '*/*'), -1);

            assert.equal(hcn.mediaRangeValueCompare('*/*', 'a/aa'), 1);
            assert.equal(hcn.mediaRangeValueCompare('*/*', 'a/*'), 1);
            assert.equal(hcn.mediaRangeValueCompare('*/*', '*/aa'), 1);
            assert.equal(hcn.mediaRangeValueCompare('*/*', '*/*'), 0);
        });
    });
});

describe('awsNegotiateEncoding', function() {
    it('should return the best server value if no Accept-Encoding found', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'user-agent': [{'key': 'User-Agent', 'value': 'Firefox'}]},
                [['gzip', 0.5], ['br', 1], ['identity', 0.1]]),
            'br'
        );
    });
    it('should assume an implicit identity;q=1 value', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5'}]},
                [['identity', 1], ['gzip', 1]]),
            'identity'
        );
    });
    it('should allow implicit identity value to be overridden explicitly', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5, identity;q=0'}]},
                [['identity', 1], ['gzip', 1]]),
            'gzip'
        );
    });
    it('should allow implicit identity value to be overridden by wildcard', function() {
        assert.equal(
            hcn.awsNegotiateEncoding(
                {'accept-encoding':
                    [{'key': 'Accept-Encoding', 'value': 'gzip;q=0.5, *;q=0'}]},
                [['identity', 1], ['gzip', 1]]),
            'gzip'
        );
    });
});