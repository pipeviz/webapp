var d3 = require('bower_components/d3/d3'),
    queue = require('bower_components/queue-async/queue'),
    _ = require('bower_components/lodash/dist/lodash'),
    React = require('bower_components/react/react-with-addons.js');

var Container = require('./Container'),
    LogicState = require('./LogicState'),
    Process = require('./Process'),
    DataSpace = require('./DataSpace.js'),
    DataSet = require('./DataSet'),
    Anchor = require('./Anchor'),
    LGroup = require('./LGroup'),
    PVD = require('./PVD');

var graphRender = function(el, state, props) {
    var link = d3.select(el).selectAll('.link')
            .data(props.links, function(d) { return d.source.objid() + '-' + d.target.objid(); }),
        node = d3.select(el).selectAll('.node')
            .data(props.nodes, function(d) { return d.objid(); });

    link.enter().append('line')
        .attr('class', function(d) {
            if (d.source instanceof Anchor || d.target instanceof Anchor) {
                return 'link anchor';
            }
            if (_.has(d, 'path')) {
                return 'link link-commit';
            }
            return 'link';
        })
        .style('stroke-width', function(d) {
            return (d.path && d.path.length > 0) ? 1.5 * Math.sqrt(d.path.length) : 1;
        });

    var nodeg = node.enter().append('g')
        .attr('class', function(d) {
            return 'node ' + d.vType();
        });

    nodeg.append('circle')
        .attr('x', 0)
        .attr('y', 0)
        .attr('r', function(d) {
            if (d instanceof LGroup) {
                return 45;
            }
            if (d instanceof Anchor) {
                return 0;
            }
        })
        .on('click', props.target);

    nodeg.append('image')
        .attr('class', 'provider-logo')
        .attr('height', 22)
        .attr('width', 22)
        .attr('y', '-37')
        .attr('x', '-10')
        .attr('xlink:href', function(d) {
            if (d instanceof Anchor) {
                return;
            }

            // FIXME hahahahahhahahahahahahhaha hardcoded
            return 'assets/' + d.ref()._container.provider + '.svg';
        });

    var nodetext = nodeg.append('text');
    nodetext.append('tspan')
        .text(function(d) { return d.name(); });
    nodetext.append('tspan')
        .text(function(d) {
            // FIXME omg terrible
            if (d instanceof Anchor) {
                return '';
            }

            return d.ref().id.commit.slice(0, 7);
        })
        .attr('dy', "1.4em")
        .attr('x', 0)
        .attr('class', function(d) {
            if (d instanceof Anchor) {
                return;
            }

            var output = 'commit-subtext',
                commit = d.ref().id.commit;

            if (_.has(props.commitMeta, commit) &&
                _.has(props.commitMeta[commit], 'testState')) {
                output += ' commit-' + props.commitMeta[commit].testState;
            }

            return output;
        });

    node.exit().remove();
    link.exit().remove();

    state.force.on('tick', function() {
        link.attr("x1", function(d) { return d.source.x; })
            .attr("y1", function(d) { return d.source.y; })
            .attr("x2", function(d) { return d.target.x; })
            .attr("y2", function(d) { return d.target.y; });

        node.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    state.force.start();
    return false;
};

var Viz = React.createClass({
    displayName: "pipeviz-graph",
    getInitialState: function() {
        return {
            force: d3.layout.force()
                .charge(-4000)
                .chargeDistance(250)
                .size([this.props.width, this.props.height])
                .linkStrength(function(link) {
                    if (link.source instanceof Container) {
                        return 0.5;
                    }
                    if (link.source instanceof Anchor || link.target instanceof Anchor) {
                        return 1;
                    }
                    return 0.3;
                })
                .linkDistance(function(link) {
                    if (link.source instanceof Anchor || link.target instanceof Anchor) {
                        return 25;
                    }
                    return 250;
                })
        };
    },
    getDefaultProps: function() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            nodes: [],
            links: [],
            target: function() {}
        };
    },
    render: function() {
        return React.DOM.svg({
            className: "pipeviz",
            viewBox: "0 0 " + this.props.width + " " + this.props.height
        });
    },
    componentDidUpdate: function() {
        this.state.force.nodes(this.props.nodes);
        this.state.force.links(this.props.links);

        return graphRender(this.getDOMNode(), this.state, this.props);
    },
    shouldComponentUpdate: function(nextProps, nextState) {
        // FIXME totally cheating for now and just going by length.
        if (nextProps.nodes.length !== this.state.force.nodes().length) {
            return true;
        }
        if (nextProps.links.length !== this.state.force.links().length) {
            return true;
        }
        return false;
    }
});

var InfoBar = React.createClass({
    displayName: 'pipeviz-info',
    render: function() {
        var t = this.props.target,
            cmp = this;

        var outer = {
            id: "infobar",
            children: []
        };

        if (typeof t !== 'object') {
            outer.children = [React.DOM.p({}, "nothing selected")];
            // drop out early for the empty case
            return React.DOM.div(outer);
        }

        // find all linked envs for the logic state
        var linkedContainers = [t.ref()._container]; // parent env
        // env linked through dataset
        if (_.has(t.ref(), 'datasets')) {
            _.forOwn(t.ref().datasets, function(ds) {
                if (_.has(ds.loc, 'hostname')) {
                    linkedContainers.push(cmp.props.pvd.byHostname(ds.loc.hostname));
                }
            });
        }

        linkedContainers = _.uniq(linkedContainers);

        // title for containers
        outer.children.push(React.DOM.h3({}, t.name()));
        // list of containers
        outer.children.push(React.DOM.ul({children: [
            React.DOM.li({children: [
                'Comprises ' + linkedContainers.length + ' env(s), with hostnames:',
                React.DOM.ul({}, _.map(linkedContainers, function(d) {
                    return React.DOM.li({}, d.name());
                }))
            ]}),
            React.DOM.li({}, 'App path: ' + t.ref()._path)
        ]}));

        outer.children.push(React.DOM.h3({}, 'Active commit'));

        var commit = this.props.commits[t.ref().id.commit];
        var sha1line =  'sha1: ' + t.ref().id.commit.slice(0, 7);

        if (_.has(this.props.commitMeta, t.ref().id.commit) &&
            _.has(this.props.commitMeta[t.ref().id.commit], 'testState')) {
            sha1line += ' (' + this.props.commitMeta[t.ref().id.commit].testState + ')';
        }

        var items = [
            sha1line,
            commit.date,
            commit.author,
            '"' + commit.message + '"'
        ];

        outer.children.push(React.DOM.ul({
            children: items.map(function(d) {
                return React.DOM.li({}, d);
            })
        }));
        return React.DOM.div(outer);
    }
});

var ControlBar = React.createClass({
    displayName: 'pipeviz-control',
    render: function() {
        var fc = this.props.filterChange;
        var boxes = this.props.filters.map(function(d) {
            return (<input type="checkbox" checked={d.selected} onChange={fc.bind(this, d.id)}>{d.id}</input>);
        });

        return (
            <div id="controlbar">
                Filters: {boxes}
                Sort by: <input type="checkbox" checked={this.props.commitsort}
                onChange={this.props.csChange}>commits</input>
            </div>
        );
    },
});

var App = React.createClass({
    displayName: 'pipeviz',
    getInitialState: function() {
        return {
            // FIXME having these in state is a bit fucked up...but consistency
            // in viz child class' state leaves us no choice for now
            anchorL: new Anchor(0, this.props.vizHeight/2),
            anchorR: new Anchor(this.props.vizWidth, this.props.vizHeight/2),
            gData: {},
            commits: [],
            commitsort: true,
            commitMeta: {},
            nodes: [],
            links: [],
            pvd: new PVD(),
            target: undefined,
            filters: Object.keys(this.filterFuncs).map(function(id) {
                // TODO haha hardcoding
                if (id === 'container') {
                    return {id: id, selected: false};
                }
                return {id: id, selected: true};
            })
        };
    },
    getDefaultProps: function() {
        return {
            vizWidth: window.innerWidth * 0.83,
            vizHeight: window.innerHeight
        };
    },
    filterChange: function(id) {
        var filters = this.state.filters.map(function(d) {
            return {
                id: d.id,
                selected: (d.id === id ? !d.selected : d.selected)
            };
        });

        this.setState({filters: filters});
    },
    toggleCommitSort: function() {
        this.setState({commitsort: !this.state.commitsort});
    },
    filterFuncs: {
        'container': function(node) {
            return !(node instanceof Container);
        },
        'process': function(node) {
            return !(node instanceof Process);
        },
        'logic': function(node) {
            return !(node instanceof LogicState);
        },
        'dataspace': function(node) {
            return !(node instanceof DataSpace);
        },
        'dataset': function(node) {
            return !(node instanceof DataSet);
        }
    },
    buildNodeFilter: function() {
        var check = _.filter(this.state.filters, function(d) {
            return d.selected;
        }).map(function(d) {
            return d.id;
        });

        var funcs = _.reduce(this.filterFuncs, function(accum, f, k) {
            if (_.contains(check, k)) {
                accum.push(f);
            }
            return accum;
        }, []);

        // TODO just hacking this one on the end. super-hardcoding to our app
        funcs.push(function(node) {
            var filter = false;

            _.each(node.logicStates(), function(ls) {
                if (ls.nick === 'ourapp') {
                    filter = true;
                    return false;
                }
            });

            return filter;
        });

        if (funcs.length > 0) {
            // if any filter func returns false, we throw it out (logical OR)
            return function(node) {
                for (i = 0; i < funcs.length; i++) {
                    if (!funcs[i](node)) {
                        return false;
                    }
                }
                return true;
            };
        } else {
            return false;
        }
    },
    buildLinkFilter: function() {
        // TODO atm we have no direct link filtering, this just
        // filters links that are incident to filtered nodes
        var nf = this.buildNodeFilter();

        return nf ? function(link) {
            return nf(link.source) && nf(link.target);
        } : nf;
    },
    populatePVDFromJSON: function(pvd, containerData) {
        _.each(containerData, function(container) {
            pvd.attachContainer(new Container(container));
        });

        return pvd;
    },
    calculateCommitLinks: function(lgroups) {
        var g = new graphlib.Graph(),
            links = [],
            cmp = this,
            members = {};

        _.each(this.state.commits, function(cdatum, hash) {
            _.each(cdatum.parents, function(phash) {
                g.setEdge(hash, phash);
            });
        });

        _.each(lgroups, function(lgroup) {
            var ls = lgroup.ref();
            if (ls.id && ls.id.commit && _.has(cmp.state.commits, ls.id.commit)) {
                // FIXME this is the spot where we'd need to deal with multiple
                // instances being on the same commit...only kinda doing it now
                if (!_.has(members, ls.id.commit)) {
                    members[ls.id.commit] = [];
                }
                members[ls.id.commit].push({commit: ls.id.commit, obj: lgroup});
            }
        });

        // now traverse depth-first to figure out the overlaid edge structure
        var visited = [], // "black" list - vertices that have been visited
            path = [], // the current path of interstitial commits
            npath = [], // the current path, nodes only
            from, // head of the current exploration path
            v; // vertex (commit) currently being visited

        var walk = function(v) {
            // guaranteed acyclic, safe to skip grey/back-edge

            var pop_npath = false;
            // grab head of node path from stack
            from = npath[npath.length - 1];

            if (visited.indexOf(v) !== -1) {
                // Vertex is black/visited; create link and return.
                _.each(members[v], function(tgt) {
                    from.map(function(src) {
                        links.push({ source: src.obj, target: tgt.obj, path: path.slice(0) });
                    });
                });
                path = [];
                return;
            }

            if (_.map(from, function(obj) { return obj.commit; }).indexOf(v) === -1) {
                if (_.has(members, v)) {
                    // Found node point. Create a link
                    _.each(members[v], function(tgt) {
                        from.map(function(src) {
                            links.push({ source: src.obj, target: tgt.obj, path: path.slice(0) });
                        });
                    });

                    // Our exploration structure inherently guarantees a spanning
                    // tree, so we can safely discard historical path information ERR, NO IT DOESN'T
                    path = [];

                    // Push newly-found node point onto our npath, it's the new head
                    npath.push(members[v]);
                    // Correspondingly, indicate to pop the npath when exiting
                    pop_npath = true;
                }
                else {
                    // Not a node point and not self - push commit onto path
                    path.push(v);
                }
            }

            // recursive call, the crux of this depth-first traversal
            g.successors(v).map(function(s) {
                walk(s);
            });

            // Mark commit black/visited...but only if it's a member-associated
            // one. This trades CPU for memory, as it triggers a graph
            // re-traversal interstitial commits until one associated with an
            // instance is found. The alternative is keeping a map from ALL
            // interstitial commits to the eventual instance they arrive at...
            // and that's icky.
            if (_.has(members, v)) {
                visited.push(v);
            }

            if (pop_npath) {
                npath.pop();
            }
        };

        var stack = _.reduce(g.sources(), function(accum, commit) {
            // as long as we're in here, put the source anchor link in
            _.each(members[commit], function(member) {
                links.push({ source: cmp.state.anchorL, target: member.obj });
            });

            // FIXME this assumes the sources of the commit graph we have happen to
            // align with commits we have in other logic states
            return _.has(members, commit) ? accum.concat(members[commit]) : accum;
        }, []);

        _.each(g.sinks(), function(commit) {
            _.each(members[commit], function(member) {
                links.push({ source: member.obj, target: cmp.state.anchorR });
            });
        });

        // DF walk, working from source commit members
        while (stack.length !== 0) {
            v = stack.pop();
            npath.push(members[v.commit]);
            walk(v.commit);
        }

        return links;
    },
    targetNode: function(event) {
        this.setState({target: event});
    },
    render: function() {
        // FIXME can't afford to search the entire graph on every change, every
        // time in the long run
        var nf = this.buildNodeFilter();
        var nodes = this.state.pvd.findLogicalGroups();
        var graphData = [_.values(nodes), []];


        if (this.state.commitsort) {
            // FIXME wrong to change this state here like this, just making it work
            this.state.anchorL.x = 0;
            this.state.anchorL.y = this.props.vizHeight/2;
            this.state.anchorR.x = this.props.vizWidth;
            this.state.anchorR.y = this.props.vizHeight/2;

            graphData[0] = graphData[0].concat([this.state.anchorL, this.state.anchorR]);
            graphData[1] = graphData[1].concat(this.calculateCommitLinks(nodes));
        }

        return (
            <div id="pipeviz">
                <Viz width={this.props.vizWidth} height={this.props.vizHeight} nodes={graphData[0]} links={graphData[1]} target={this.targetNode} commitMeta={this.state.commitMeta}/>
                <InfoBar target={this.state.target} commits={this.state.commits} pvd={this.state.pvd} commitMeta={this.state.commitMeta}/>
            </div>
        );
    },
});

React.render(React.createElement(App, {gData: JSON.parse(document.getElementById("pipe-graph").innerHTML)}), document.body);
