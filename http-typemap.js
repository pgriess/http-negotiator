/*
 * Parse and represent type maps.
 *
 * The concept of a type map and the syntax is defined by the Apache
 * webserver documentation at
 * 
 *  https://httpd.apache.org/docs/current/mod/mod_negotiation.html#typemaps
 */

'use strict';

/*
 * A single entry in the typemap file.
 */
const TypeMapEntry = class {
    constructor() {
        this.uri = undefined;
        this.headers = new Map();
    }
};

/*
 * Parse a string into an array of TypeMapEntry objects.
 */
const parseTypemap = (str) => {
    const lines = str.split(/\n/);

    let types = [];
    let entry = undefined;

    for (let i = 0; i < lines.length; ++i) {
        const l = lines[i].trim();
        if (l[0] == '#') {
            continue;
        }

        if (l.length == 0) {
            if (entry) {
                types.push(entry);
                entry = undefined;
            }

            continue;
        }

        if (!entry) {
            entry = new TypeMapEntry();
        }

        // XXX: How does this handle malformed lines, e.g. w/o any separator at all
        const [hn, hv] = l.split(':', 2);
        if (hn == 'URI') {
            entry.uri = hv.trim();
        } else {
            entry.headers.set(hn, hv.trim());
        }
    }

    // EOF indicates the end of the last entry as well; flush it
    if (entry) {
        types.push(entry);
    }

    return types;
};
exports.parseTypemap = parseTypemap;