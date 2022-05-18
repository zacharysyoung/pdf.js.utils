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

function createWalker(data, root) {
    var pdf = new PDFDocument(null, data);
    pdf.parseStartXRef();
    pdf.parse();
    var xref = pdf.xref;
    if (!root || root === 'trailer') {
        root = xref.trailer;
    } else {
        var ref = new Ref(root.num, root.gen);
        root = xref.fetch(ref);
    }

    function addChildren(node, nodesToVisit) {
        var children = node.children;
        for (var i = children.length - 1; i >= 0; i--) {
            nodesToVisit.push(children[i]);
        }
    }

    function walk(nodesToVisit, visit, renderGPTS) {
        while (nodesToVisit.length) {
            var currentNode = nodesToVisit.pop();

            if (currentNode.name == 'GPTS') {
                renderGPTS = true;
            }

            if (renderGPTS) {
                console.log('-'.repeat(currentNode.depth) + toText(currentNode));
            }

            if (currentNode.depth > 20) {
                // console.error('Max depth exceeded.');
                continue;
            }

            if (isRef(currentNode.obj)) {
                var fetched = xref.fetch(currentNode.obj);
                currentNode = new Node(fetched, currentNode.name, currentNode.depth, currentNode.obj);
            }
            var visitChildren = visit(currentNode, function (currentNode, visit) {
                walk(currentNode.children.reverse(), visit, renderGPTS);
            }.bind(null, currentNode));

            if (visitChildren) {
                addChildren(currentNode, nodesToVisit);
            }
        }
    }

    var node = [ new Node(root, 'Trailer', 0) ];
    walk(node, ()=> true, false);
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
        console.log(obj);
        throw new Error('Unknown obj');
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
    createWalker(data, root);
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
