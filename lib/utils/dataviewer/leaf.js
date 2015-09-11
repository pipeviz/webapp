var React = require('react');
var D = React.DOM;

var uid = require('./uid');
var type = require('./type');

var Highlighter = require('./highlighter');
var highlighter = React.createFactory(Highlighter);

var pvd = require('../pvd.js');
var query = require('../query.js');
var _ = require('lodash');

var PATH_PREFIX = '.root.';

var Leaf = React.createClass({
  getInitialState: function() {
    return {
      expanded: this._isInitiallyExpanded(this.props)
    };
  },
  getDefaultProps: function() {
    return {
      root: false,
      prefix: ''
    };
  },
  render: function() {
      var id = 'id_' + uid();
      var p = this.props;

      var d = {
        path: this.keypath(),
        key: p.label.toString(),
        value: p.data
      };

      var onLabelClick = this._onClick.bind(this, d);

      return D.div({ className: this.getClassName(), id: 'leaf-' + this._rootPath() },
        D.input({ className: 'pv-dataviewer__radio', type: 'radio', name: p.id, id: id, tabIndex: -1 }),
        D.label({ className: 'pv-dataviewer__line', htmlFor: id, onClick: onLabelClick },
          D.div({ className: 'pv-dataviewer__flatpath' }, d.path),
          D.span({ className: 'pv-dataviewer__key' },
            this.format(d.key),
            ':',
            this.renderInteractiveLabel(d.key, true)),
          this.renderTitle(),
          this.renderShowOriginalButton()),
        this.renderChildren());
  },
  renderTitle: function() {
    var data = this.data();
    var t = type(data);

    switch (t) {
      case 'Array':
        return D.span({ className: 'pv-dataviewer__value pv-dataviewer__value_helper' },
                      '[] ' + items(data.length));
        case 'Object':
          if (pvd.isVertex(data) || pvd.isEdge(data)) {
            return D.span({ className: 'pv-dataviewer__value pv-dataviewer__value_helper' },
                          data.Typ() + (query.objectLabel(data) ? ' ' + query.objectLabel(data) : ''));
          } else if (_.has(data, 'isPropObj')) {
            // Condense property objects into a single "value"
            return D.span({ className: 'pv-dataviewer__value pv-dataviewer__propvalue pv-dataviewer__value_' + type(data.value).toLowerCase() },
                          this.format(String(data.value)) + "  (from msg: " + data.msgsrc + ")",
                          this.renderInteractiveLabel(data.value, false));
          }

          return D.span({ className: 'pv-dataviewer__value pv-dataviewer__value_helper' },
                        '{} ' + items(Object.keys(data).length));
        default:
          return D.span({ className: 'pv-dataviewer__value pv-dataviewer__value_' + t.toLowerCase() },
                        this.format(String(data)),
                        this.renderInteractiveLabel(data, false));
    }
  },
  renderChildren: function() {
    var p = this.props;
    var childPrefix = this._rootPath();
    var data = this.data();
    var shared = {
      prefix: childPrefix,
      onClick: p.onClick,
      id: p.id,
      query: p.query,
      getOriginal: this.state.original ? null : p.getOriginal,
      isExpanded: p.isExpanded,
      interactiveLabel: p.interactiveLabel,
      graph: p.graph
    };

    if (this.state.expanded && !isPrimitive(data)) {
      if (pvd.isVertex(data) || pvd.isEdge(data)) {
        var isv = pvd.isVertex(data);
        // id up front
        var children = [leaf(_.assign({
          data: data.id,
          label: "id",
          key: getLeafKey("id", data.id)
        }, shared))];

        // etype/vtype next
        children.push(leaf(_.assign({
          data: data.Typ(),
          label: isv ? "vtype" : "etype",
          key: getLeafKey(isv ? "vtype" : "etype", data.Typ())
        }, shared)));

        if (!isv) {
          // stick the source and target in now for edges
          children.push(leaf(_.assign({
            data: p.graph.get(data.source),
            label: "source",
            key: getLeafKey("source", {})
          }, shared)));

          children.push(leaf(_.assign({
            data: p.graph.get(data.target),
            label: "target",
            key: getLeafKey("target", {})
          }, shared)));
        }

        // now, props
        children.push(leaf(_.assign({
          data: _.mapValues(pvd.isVertex(data) ? data.vertex.properties : data.properties, function(v) {
            return _.assign({isPropObj: true}, v);
          }),
          label: "properties",
          key: getLeafKey("properties", {}) // just cheat
        }, shared, { isExpanded: function() { return true; }}))); // always expand from prop level downwards
        //}, shared))); // always expand from prop level downwards

        // finally, if it's a vertex, add the edges
        if (isv) {
          children.push(leaf(_.assign({
            data: _.assign(Object.create(expander),
                           _.zipObject(_.map(data.outEdges, function(eid) {
                             return [eid, p.graph.get(eid)];
                           }))),
            label: "outEdges",
            key: getLeafKey("outEdges", {}) // just cheat
          }, shared)));
        }

        return children;
      } else {
        return Object.keys(data).map(function(key) {
          var value = data[key];

          // hardcode: use the vertex id instead of array position
          if (p.root) {
            key = data[key].id;
          }

          return leaf({
            data: value,
            label: key,
            prefix: childPrefix,
            onClick: p.onClick,
            id: p.id,
            query: p.query,
            getOriginal: this.state.original ? null : p.getOriginal,
            key: getLeafKey(key, value),
            isExpanded: p.isExpanded,
            interactiveLabel: p.interactiveLabel,
            graph: p.graph
          });
        }, this);
      }
    }

    return null;
  },
  renderShowOriginalButton: function() {
    var p = this.props;

    if (isPrimitive(p.data) || this.state.original || !p.getOriginal || !p.query || contains(this.keypath(), p.query)) {
      return null;
    }

    return D.span({
      className: 'pv-dataviewer__show-original',
      onClick: this._onShowOriginalClick
    });
  },
  renderInteractiveLabel: function(originalValue, isKey) {
    if (typeof this.props.interactiveLabel === 'function') {
      return this.props.interactiveLabel({
        // The distinction between `value` and `originalValue` is
        // provided to have backwards compatibility.
        value: String(originalValue),
        originalValue: originalValue,
        isKey: isKey,
        keypath: this.keypath()
      });
    }

    return null;
  },
  componentWillReceiveProps: function(p) {
    if (p.query) {
      this.setState({
        expanded: !contains(p.label, p.query)
      });
    }

    // Restore original expansion state when switching from search mode
    // to full browse mode.
    if (this.props.query && !p.query) {
      this.setState({
        expanded: this._isInitiallyExpanded(p)
      });
    }
  },
  _rootPath: function() {
    return this.props.prefix + '.' + this.props.label;
  },
  keypath: function() {
    return this._rootPath().substr(PATH_PREFIX.length);
  },
  data: function() {
    return this.state.original || this.props.data;
    //return this.state.original || (_.has(this.props.data, 'isPropObj') ? this.props.data.value : this.props.data);
  },
  format: function(string) {
    return highlighter({
      string: string,
      highlight: this.props.query
    });
  },
  getClassName: function() {
    var cn = 'pv-dataviewer__leaf';

    if (this.props.root) {
      cn += ' pv-dataviewer__leaf_root';
    }

    if (this.state.expanded) {
      cn += ' pv-dataviewer__leaf_expanded';
    }

    if (!isPrimitive(this.props.data)) {
      cn += ' pv-dataviewer__leaf_composite';
    }

    return cn;
  },
  toggle: function() {
    this.setState({
      expanded: !this.state.expanded
    });
  },
  _onClick: function(data, e) {
    this.toggle();
    this.props.onClick(data);

    e.stopPropagation();
  },
  _onShowOriginalClick: function(e) {
    this.setState({
      original: this.props.getOriginal(this.keypath())
    });

    e.stopPropagation();
  },
  _isInitiallyExpanded: function(p) {
    var keypath = this.keypath();

    if (p.root) {
      return true;
    }

    if (p.query === '') {
      return p.isExpanded(keypath, p.data);
    } else {
      // When a search query is specified, first check if the keypath
      // contains the search query: if it does, then the current leaf
      // is itself a search result and there is no need to expand further.
      //
      // Having a `getOriginal` function passed signalizes that current
      // leaf only displays a subset of data, thus should be rendered
      // expanded to reveal the children that is being searched for.
      return !contains(keypath, p.query) && (typeof p.getOriginal === 'function');
    }
  }
});

var expander = {
  initialExpand: function() { return true; }
};

// FIXME: There should be a better way to call a component factory from inside
// component definition.
var leaf = React.createFactory(Leaf);

function items(count) {
    return count + (count === 1 ? ' item' : ' items');
}

function getLeafKey(key, value) {
    if (isPrimitive(value)) {
        return key + ':' + value;
    } else {
        return key + '[' + type(value) + ']';
    }
}

function contains(string, substring) {
    return string.indexOf(substring) !== -1;
}

function isPrimitive(value) {
    var t = type(value);
    return (t !== 'Object' || _.has(value, 'isPropObj')) && t !== 'Array';
}

module.exports = Leaf;
