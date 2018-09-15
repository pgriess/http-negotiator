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
            ['deflate', 'gzip', 'br', 'identity', 'deflate']);
    });
    it('should strip optional whitespace', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept-Encoding', 'value': 'gzip , br,identity '}]),
            ['gzip', 'br', 'identity']);
    });
    it('should not be confused by / characters', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept', 'value': 'image/png, image/webp'}]),
            ['image/png', 'image/webp']);
    });
    it('should not be confused by * characters', function() {
        assert.deepStrictEqual(
            hcn.splitHeaders([
                {'key': 'Accept', 'value': 'image/*, */*'}]),
            ['image/*', '*/*']);
    });
});

describe('parseHeaderValue()', function() {
    it('should handle items with no attributes', function() {
        assert.deepStrictEqual(hcn.parseHeaderValue('foo'), ['foo', {}]);
    });
    it('should parse multiple attributes with values', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('foo;a=1;b=2'),
            ['foo', {'a': '1', 'b': '2'}]);
    });
    it('should handle attributes after wildcards', function() {
        assert.deepStrictEqual(
            hcn.parseHeaderValue('image/*;a=1;b=2'),
            ['image/*', {'a': '1', 'b': '2'}]);
    });
});

describe('sortHeadersbyQValue', function() {
    it('should respect q attribute values', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([['gzip', {'q': '0.25'}]]),
            [['gzip', 0.25]]);
    });
    it('should infer a q attribute value of 1 if un-specified', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([['gzip', {}]]),
            [['gzip', 1]]);
    });
    it('should allow later items to override earlier ones', function() {
        assert.deepStrictEqual(
            hcn.sortHeadersByQValue([
                ['gzip', {}],
                ['br', {'q': '0.8'}],
                ['gzip', {'q': '0.25'}],
            ]),
            [['br', 0.8], ['gzip', 0.25]]);
    });
});

describe('performNegotiation()', function() {
    it('should select the common value', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 1]],
                [['c', 1], ['z', 1]]
            ),
            'c'
        );
    });
    it('should fail if there are no common values', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 1]],
                [['z', 1]]
            ),
            null
        );
    });
    it('should take client weights into account', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 0.8]],
                [['b', 0.9], ['c', 1]]
            ),
            'b'
        );
    });
    it('should take server weights into account', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1], ['b', 1], ['c', 1]],
                [['b', 0.9], ['c', 1]]
            ),
            'c'
        );
    });
    it('should consider 0-weights as a non-match', function() {
        assert.deepStrictEqual(
            hcn.performNegotiation(
                [['a', 1]],
                [['a', 0]]),
            null
        );
    });
});