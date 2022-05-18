'use strict';

//
// Helper functions.
//

String.prototype.repeat = function (num) {
    return new Array(num + 1).join(this);
};

function getData(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = (function() {
        var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
        callback(data);
    }).bind(this);
    xhr.send(null);
}

function parseQueryString(query) {
    var parts = query.split('&');
    var params = {};
    for (var i = 0, ii = parts.length; i < parts.length; ++i) {
        var param = parts[i].split('=');
        var key = param[0];
        var value = param.length > 1 ? param[1] : null;
        params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
    return params;
}

//
// Walking
//

function StreamContents(stream) {
    this.stream = stream;
}

function Node(obj, name, depth, ref) {
    this.obj = obj;
    this.name = name;
    this.depth = depth;
    this.ref = ref;
}

Node.prototype = {
    get children() {
        var depth = this.depth + 1;
        var obj = this.obj;
        var children = [];
        if (isDict(obj) || isStream(obj)) {
            var map;
            if (isDict(obj)) {
                map = obj.map;
            } else {
                map = obj.dict.map;
            }
            for (var key in map) {
                var value = map[key];
                children.push(new Node(value, key, depth));
            }
            if (isStream(obj)) {
                children.push(new Node(new StreamContents(obj), 'Contents', depth));
            }
        } else if (isArray(obj)) {
            for (var i = 0, ii = obj.length; i < ii; i++) {
                var value = obj[i];
                children.push(new Node(value, i, depth));
            }
        }
        return children;
    },
};

const MAX_DEPTH = 10;

function createWalker(data) {
    var pdf = new PDFDocument(null, data);
    pdf.parseStartXRef();
    pdf.parse();
    var xref = pdf.xref;
    var root = xref.trailer;

    var rootNode = new Node(root, 'Trailer', 0);

    function walk(node, callDepth, nodePath) {
        // Not sure about this, but I think I'm directing the walker to completely resolve referenced nodes
        while (isRef(node.obj)) {
            var fetched = xref.fetch(node.obj);
            node = new Node(fetched, node.name, node.depth, node.obj);
        }

        nodePath += ' // ' + toText(node);

        if (node.name === 'GPTS') {
            console.log(nodePath);
            return;
        }

        if (callDepth > MAX_DEPTH) {
            return;
        }

        for (const childNode of node.children) {
            walk(childNode, callDepth + 1, nodePath);
        }
    }

    return {
        start: () => walk(rootNode, 1, ''),
    };
}

//
// Tree decoration.
//

function toText(node) {
    var name = node.name;
    var obj = node.obj;
    var description = '';
    if (isDict(obj)) {
        description = name + ' (dict)';
    } else if (isArray(obj)) {
        description = name + ' (array)';
    } else if (isStream(obj)) {
        description = name + ' (stream)';
    } else if (isName(obj)) {
        description = name + ' = /' + obj.name;
    } else if (isNum(obj)) {
        description = name + ' = ' + obj;
    } else if (isBool(obj)) {
        description = name + ' = ' + obj;
    } else if (isString(obj)) {
        if (obj.startsWith('\u00FE\u00FF')) {
            // Text encoded as UTF-16BE bytes, see §7.9.2.2 "Text String Type" of PDF 32000-1:2008
            // https://wwwimages2.adobe.com/content/dam/Adobe/en/devnet/pdf/pdfs/PDF32000_2008.pdf#G6.1957385
            var decoded = '';
            for (var i = 2; i < obj.length; i += 2) {
                decoded += String.fromCharCode(obj.charCodeAt(i) << 8 | obj.charCodeAt(i + 1));
            }
            obj = decoded;
        }
        description = name + ' = ' + JSON.stringify(obj) + '';
    } else if (obj instanceof StreamContents) {
        description = '<contents>';
    } else {
        description = JSON.stringify(obj);
        // throw new Error('Unknown obj');
    }

    if (node.ref) {
        description += ' [id: ' + node.ref.num + ', gen: ' + node.ref.gen + ']';
    }
    return description;
}


var Browser = {};

function go(data) {
    Browser.data = data;
    var hash = document.location.hash.substring(1);
    var hashParams = parseQueryString(hash);
    var root = null;
    if (hashParams.root) {
        var split = hashParams.root.split(',');
        root = { num: split[0], gen: split[1] };
    }
    var w = createWalker(data);
    w.start();
    return;
}

window.addEventListener('change', function webViewerChange(evt) {
    var files = evt.target.files;
    if (!files || files.length === 0)
        return;

    // Read the local file into a Uint8Array.
    var fileReader = new FileReader();
    fileReader.onload = function webViewerChangeFileReaderOnload(evt) {
        var main = document.querySelector('#main');
        if (main) {
            document.body.removeChild(main);
        }
        var buffer = evt.target.result;
        var uint8Array = new Uint8Array(buffer);

        go(uint8Array);
    };

    var file = files[0];
    fileReader.readAsArrayBuffer(file);

}, true);

window.addEventListener('hashchange', function (evt) {
    go(Browser.data);
});

var params = parseQueryString(document.location.search.substring(1));
if (params.file) {
    getData(params.file, function(data) {
        go(data);
    });
}
