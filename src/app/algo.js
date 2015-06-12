// TODO memoize this
var reachCounts = function(g, v, filter) {
    var succ = g.successors(v),
    r = function(accum, value) {
        accum.push(_.foldl(g.successors(value), r, []));
        return accum;
    };

    if (succ === undefined) {
        return 0;
    } else if (filter === undefined) {
        return _.uniq(_.flatten(_.foldl(succ, r, []))).length + 1;
    } else {
        return _.intersection(_.uniq(_.flatten(_.foldl(succ, r, [])), filter)).length + 1;
    }
};

var reachCountp = function(g, v, filter) {
    var pred = g.predecessors(v),
    r = function(accum, value) {
        accum.push(_.foldl(g.predecessors(value), r, []));
        return accum;
    };

    if (pred === undefined) {
        return 0;
    } else if (filter === undefined) {
        return _.uniq(_.flatten(_.foldl(succ, r, []))).length + 1;
    } else {
        return _.intersection(_.uniq(_.flatten(_.foldl(pred, r, [])), filter)).length + 1;
    }
};

/*
 * The main magic function for processing a pv graph into the base state usable
 * for the app/commit viz.
 *
 */
function extractVizGraph(g, repo) {
    var focalCommits = {},
    focal = _.filter(_.map(g.verticesWithType("logic-state"), function(d) { return _.create(vertexProto, d); }), function(v) {
        var vedges = _.filter(_.map(v.outEdges, function(edgeId) { return g.get(edgeId); }), isType("version"));
        if (vedges.length === 0) {
            return false;
        }

        if (g.get(vedges[0].target).propv("repository") === repo) {
            if (!_.has(focalCommits, vedges[0].target)) {
                focalCommits[vedges[0].target] = [];
            }
            focalCommits[vedges[0].target].push(v);
            return true;
        }
    });

    if (focal.length === 0) {
        return;
    }

    var cg = g.commitGraph(), // TODO narrow to only commits in repo
    fg = new graphlib.Graph(), // graph with all non-focal vertices contracted and edges transposed (direction reversed)
    isg = new graphlib.Graph(), // the induced subgraph; actually a tree, for now
    visited = {},
    candidates = [];

    // Depth-first walk to build the focal graph and find root candidates
    var fgwalk = function(v, fpath) {
        var last = fpath.length === 0 ? [] : fpath[fpath.length - 1],
        pop_fpath = false;

        // If vertex is already focal-visited, return early. We only record focal vertices
        // in this list, so there will be some double-traversal, but that's acceptable.
        if (_.has(visited, v)) {
            // Create edges from every focal on current vertex to every focal
            // from last. No op if last is empty.
            _.each(last, function(fvs) {
                _.each(fvs, function(fv) {
                    fg.setEdge(v, fv);
                });
            });
            return;
        }

        if (_.has(focalCommits, v)) {
            // This commit has one or more of our focal vertices. Create an
            // edge if fpath is non-empty, push focals onto fpath, and set
            // var to pop fpath later.
            pop_fpath = true;

            // Create edges from every focal on current vertex to every focal
            // from last. No op if last is empty.
            _.each(last, function(fvs) {
                _.each(fvs, function(fv) {
                    fg.setEdge(v, fv);
                });
            });

            fpath.push(focalCommits[v]);
        }

        _.each(cg.successors(v), function(s) {
            fgwalk(s, fpath);
        });

        if (pop_fpath) {
            visited[v] = true;
            fpath.pop();
        }
    };

    _.each(focalCommits, function(d, k) {
        fgwalk(k, []);
    });

    // Nearly the same walk, but only follow first parent. Builds root candidate list
    // AND build the first-parent tree at the same time.
    var isgwalk = function(v, last) {
        // We always want to record the (reversed) edge, unless last does not exist
        if (last !== undefined) {
            isg.setEdge(v, last);
        }

        // If vertex is already visited, it's a candidate for being the root
        if (_.has(visited, v)) {
            candidates.push(v);
            return;
        }

        // Only visit first parent; that's the path that matters to our subgraph/tree
        var succ = cg.successors(v);
        if (succ !== undefined && succ.length > 0) {
            isgwalk(succ[0], v);
        }

        visited[v] = true;
    };

    // reset visited list
    visited = {};

    _.each(focalCommits, function(d, k) {
        isgwalk(k);
    });

    // This identifies the shared root (in git terms, the merge base) from all
    // candidates by walking down the reversed subgraph/tree until we find a
    // vertex in the candidate list. The first one we find is guaranteed to
    // be the root.
    var root,
    rootfind = function(v) {
        if (candidates.indexOf(v) !== -1) {
            root = v;
            return;
        }

        var succ = isg.successors(v) || [];
        if (succ.length > 0) {
            rootfind(succ[0]);
        }
    };
    rootfind(isg.sources()[0]);

    var vmeta = {}, // metadata we build for each vertex. keyed by vertex id
    branches = 1, // overall counter for all the branches. starts at 1, increases as needed
    mainwalk = function(v, path, branch) {
        // tree, so zero possibility of revisiting any vtx; no "visited" checks needed
        var succ = isg.successors(v) || [];
        if (_.has(focalCommits, v)) {
            vmeta[v] = {
                depth: path.length, // distance from root
                interesting: true, // all focal commits are interesting
                reach: reachCounts(fg, v),
                treach: reachCounts(isg, v, _.keys(focalCommits)),
                branch: branch
            };
        } else {
            var psucc = path === [] ? [] : isg.successors(path[path.length -1]);
            vmeta[v] = {
                depth: path.length,
                interesting: succ.length > 1 || psucc.length > 1, // interesting only if has multiple successors, or parent did
                reach: reachCountp(cg, v, _.keys(focalCommits)),
                treach: reachCounts(isg, v, _.keys(focalCommits)),
                branch: branch
            };
        }

        path.push(v);
        var i = 0;
        _.each(succ, function(d) {
            // only increase branch count if there are multiple successors
            mainwalk(d, path, branch + i++);
        });
        path.pop();
    };

    // we only need to enter at root to get everything
    mainwalk(root, [], branches);

    // now we have all the base meta; construct elidables lists and branch rankings
    var elidable = _(vmeta)
        .filter(function(v) { return v.interesting === false; })
        .map(function(v) { return v.depth; })
        .uniq()
        .value()
        .sort(function(a, b) { return a - b; }),
    elsets = _.reduce(elidable, function(accum, v, k, coll) {
        if (coll[k-1] === v-1) {
            // contiguous section, push onto last series
            accum[accum.length - 1].push(v);
        } else {
            // non-contiguous, start a new series
            accum.push([v]);
        }

        return accum;
    }, []),
    branchinfo = _(vmeta)
        .mapValues(function(v) { return v.branch; })
        .invert(true) // same as a groupBy in this context
        .mapValues(function(v) { return { ids: v, rank: 0 }; })
        .value(); // object keyed by branch number w/branch info

    _(vmeta).groupBy(function(v) { return v.depth; })
        .each(function(metas, x) {
            // TODO this needs to get much, much smarter in order to weave smartly as unsigned y
            // sort first by reach, then by tree-reach. if those end up equal, fuck it, good nuf
            _(metas).sortBy(["reach", "treach"])
                .reverse()
                .each(function(meta, rank) {
                    branchinfo[meta.branch].rank = Math.max(branchinfo[meta.branch].rank, rank);
                });
        });

    // FINALLY, assign x and y coords to all visible vertices
    var vertices = _(vmeta)
        .pick(function(v, k) { return _.indexOf(elidable, parseInt(k), true) === -1; })
        .map(function(v, k) {
            return _.assign({
                ref: _.has(focalCommits, k) ? focalCommits[k][0] : g.get(k), // TODO handle multiple on same commit
                x: v.depth - _.sortedIndex(elidable, v.depth), // x is depth, less preceding elided x-positions
                y: branchinfo[v.branch].rank // y is just the branch rank TODO alternate up/down projection
            }, v);
        }).value(),
    diameter = _.max(_.map(focalCommits, function(v, k) { return vmeta[k].depth; })),
    ediam = diameter - elidable.length;

    // TODO branches/tags

    return {
        vertices: vertices,
        elidable: elidable,
        elsets: elsets,
        g: isg,
        diameter: diameter,
        ediam: ediam,
        root: root,
        branches: branchinfo,
    };
}

/*
 * Given a viewport width and height, a diameter (number of x positions)
 * and a deviation (max y-deviation from the middle), returns
 * a set of functions for transforming x and y coordinates into the
 * numbers appropriate for the target user coordinate space.
 */
function createTransforms(vpwidth, vpheight, diameter, deviation) {
    var ar = vpwidth / vpheight,
        unit = vpwidth / (diameter + 1); // the base grid unit size, presumably in px
    // TODO different paths depending on whether x or y exceeds ratio
    return {
        unit: function() { return unit; },
        x: function(x) {
            return 0.5*unit + x*unit;
        },
        y: function(y) {
            return 0.5*vpheight + y*unit;
        },
    };
}
