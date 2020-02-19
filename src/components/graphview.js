import React from 'react'
import '../css/graphview.css'
import * as d3 from 'd3'
import add_context_menu from '../utility/add_context_menu'
import {Resizable} from 're-resizable'
import {Spinner} from '@blueprintjs/core'
import {Index} from '../utility/d3-helper/d3-helper'

const context_menu = [
    {
        onClick: {},
        text: 'Placeholder 1'
    },
    {
        onClick: {},
        text: 'Placeholder 2'
    }
];

const style = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
};

class GraphView extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            class: `graph-view ${this.props.className}`,
            mounted: false,
            node_width: 20,
            node_height: 15,
            graph: this.props.graph,
            spinner_visible: false,
        };
        this.script_updater = null;
        this.index = new Index();
        this.selected = new Set();
        this.mouse_offset = {x: 0, y: 0};
        this.centerpoint_offset = {x: 0, y: 0};
        this.scroll_proportion = {left: null, top: null};
        this.scaling_factor = 1;
        this.fill_proportion = 1;
        this.center_graph_on_point = this.center_graph_on_point.bind(this);
        this.get_canvas_bounding_box = this.get_canvas_bounding_box.bind(this);
        this.get_graph_bounding_box = this.get_graph_bounding_box.bind(this);
        this.setGraph = this.setGraph.bind(this);
        this.key_down = this.key_down.bind(this);
        this.key_up = this.key_up.bind(this);
        this.scale_graph = this.scale_graph.bind(this);
        this.scale_graph_to_fit = this.scale_graph_to_fit.bind(this);
        this.updateGraph = this.updateGraph.bind(this);
        this.capture_wheel = this.capture_wheel.bind(this);
        this.componentDidUpdate = this.componentDidUpdate.bind(this);
        this.update_scroll = this.update_scroll.bind(this);
        this.update_script = this.update_script.bind(this);
        this.move_node = this.move_node.bind(this);
        this.zoomed = this.zoomed.bind(this);
        this.blur = this.blur.bind(this);
        this.move_graph = this.move_graph.bind(this);
        this.refresh_edges_for_node = this.refresh_edges_for_node.bind(this);
        this.move_label_to_corresponding_node = this.move_label_to_corresponding_node.bind(this);
        this.initial_state = this;
        this.d3 = d3;
    }

    componentWillMount() {
        // document.querySelector(".graphview").on("keydown", function() {
        //     console.log(d3.event)
        // })
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (!(this.props.graph === prevProps.graph)) {
            if (this.props.graph === "loading") {
                d3.selectAll('svg').remove();
                this.setState({"spinner_visible": true})
            } else {
                d3.selectAll('svg').remove();
                this.setState({"spinner_visible": false});
                this.setGraph();
            }
        }
        if (!(this.props.graph_style === prevProps.graph_style)) {
            this.parse_stylesheet();
        }
        if (!(this.stylesheet)){
            this.stylesheet = {}
        }
        if (!('components' in this.stylesheet)){
            this.stylesheet.components = {}
        }
        if (!('nodes' in this.stylesheet.components)){
            this.stylesheet.components.nodes = {}
        }
    }

    componentWillUnmount() {
        window.removeEventListener('resize', this.updateGraph);
        window.removeEventListener('wheel', this.capture_wheel);
        window.removeEventListener('keydown', this.key_down);
        window.removeEventListener('keyup', this.key_up);
        window.removeEventListener('blur', this.blur);
        var win = document.querySelector('.graph-view');
        if (win) {
            win.removeEventListener('scroll', this.update_scroll);
        }
    }

    componentDidMount() {
        this.setGraph();
        window.addEventListener('resize', this.updateGraph);
        window.addEventListener('wheel', this.capture_wheel, {passive: false});
        window.addEventListener('keydown', this.key_down);
        window.addEventListener('keyup', this.key_up);
        window.addEventListener('blur', this.blur);
        // add_context_menu('.graph-view', context_menu)
    }

    cartesian_to_polar(x, y, cx, cy) {
        var distance, radians, polar, centerpoint;
        x = x - cx;
        y = y - cy;
        distance = Math.sqrt(x * x + y * y);
        radians = Math.atan2(y, x);
        polar = {distance: distance, radians: radians};
        return polar
    }

    key_down(e) {
        if (e.metaKey || e.ctrlKey) {
            if (e.key === '+' || e.key === '=') {
                this.nudge_graph_larger();
            } else if (e.key === '-') {
                this.nudge_graph_smaller();
            }
            if (e.key === 'r') {
                this.reset_graph()
            }
            if (e.key === 'a'){
                this.index.nodes.forEach(
                    (node)=>{
                        this.select_node(node)
                    }
                )
            }
        }
        if (e.key.includes('Arrow') && this.selected.size > 0){
            var increment;
            var self = this;
            e.preventDefault();
            increment = (e.metaKey||e.ctrlKey ? 25:1)/self.scaling_factor;
            if (e.key==='ArrowUp'){
                this.move_nodes(0, -increment);
            }
            if (e.key==='ArrowDown'){
                this.move_nodes(0, increment);
            }
            if (e.key==='ArrowRight'){
                this.move_nodes(increment, 0);
            }
            if (e.key==='ArrowLeft'){
                this.move_nodes(-increment, 0);
            }
        }
        if (e.key==='Escape'){
            this.unselect_all()
        }
    }

    blur(e){
        if (this.props.filewatch_fx && this.props.filepath){
            this.props.filewatch_fx(this.props.filepath)
        }
    }

    key_up(e){
        this.update_script();
    }

    update_script() {
        var stylesheet_str = JSON.stringify(this.stylesheet);
        this.props.fileunwatch_fx(this.props.filepath);
        console.log('updating')
        this.script_updater.write({styleJSON: stylesheet_str});
    }

    dist(x1, y1, x2, y2) {
        var a = x1 - x2;
        var b = y1 - y2;
        var c = Math.sqrt(a * a + b * b);
        return c
    }

    getnRect(angle, w, h) {
        var sine = Math.sin(angle), cosine = Math.cos(angle);   // Calculate once and store, to make quicker and cleaner
        var dy = Math.sin > 0 ? h / 2 : h / -2;                  // Distance to top or bottom edge (from center)
        var dx = Math.cos > 0 ? w / 2 : w / -2;                  // Distance to left or right edge (from center)
        if (Math.abs(dx * sine) < Math.abs(dy * cosine)) {           // if (distance to vertical line) < (distance to horizontal line)
            dy = (dx * sine) / cosine;                  // calculate distance to vertical line
        } else {                                      // else: (distance to top or bottom edge) < (distance to left or right edge)
            dx = (dy * cosine) / sine;                  // move to top or bottom line
        }
        return {dx: dx, dy: dy};                        // Return point on rectangle edge
    }

    reset_graph() {
        this.svg.call(this.zoom.transform, d3.zoomIdentity);
    }

    get_len_from_point_to_edge(x1, y1, x2, y2, vx, vy, px, py) {
        // algorithm to find len of vector from point to edge of rect taken from here: https://stackoverflow.com/questions/3180000/calculate-a-vector-from-a-point-in-a-rectangle-to-edge-based-on-angle
        var possible_solutions = [];
        var left_wall_test = (x1 - px) / vx;
        if (left_wall_test > 0) {
            possible_solutions.push(left_wall_test)
        }
        ;
        var right_wall_test = (x2 - px) / vx;
        if (right_wall_test > 0) {
            possible_solutions.push(right_wall_test)
        }
        ;
        var top_wall_test = (y1 - py) / vy;
        if (top_wall_test > 0) {
            possible_solutions.push(top_wall_test)
        }
        ;
        var bottom_wall_test = (y2 - py) / vy;
        if (bottom_wall_test > 0) {
            possible_solutions.push(bottom_wall_test)
        }
        ;
        return Math.min.apply(null, possible_solutions)
    }

    capture_wheel(e) {
        if (e.metaKey||e.ctrlKey) {
            this.mouse_offset = {
                x: e.offsetX,
                y: e.offsetY
            };
            e.preventDefault();
            if (e.deltaY < 0) {
                this.svg.call(this.zoom.scaleBy, 1.02, [e.offsetX, e.offsetY]);
            } else {
                this.svg.call(this.zoom.scaleBy, 0.98, [e.offsetX, e.offsetY]);
            }
        }
    }

    mouse_inside_canvas_bounds(e) {
        var canvas_bounds = this.get_canvas_bounding_box();
        if (
            e.clientX >= canvas_bounds.x && e.clientX <= canvas_bounds.x + canvas_bounds.width &&
            e.clientY >= canvas_bounds.y && e.clientY <= canvas_bounds.y + canvas_bounds.height
        ) {
            return true
        } else {
            return false
        }
    }

    generate_arc() {
        var x1 = 0,
            y1 = 0,
            x2 = 1,
            y2 = 1, // The arc collapses to a point if the beginning and ending points of the arc are the same, so kludge it.
            xRotation = 90, // Fiddle with this angle to get loop oriented.
            rx = 10, // Make drx and dry different to get an ellipse instead of a circle.
            ry = 20,
            sweep = 0; // 1 or 0; Change sweep to change orientation of loop.
        return "M" + x1 + "," + y1 + "A" + rx + "," + ry + " " + xRotation + ",1," + sweep + " " + x2 + "," + y2;
    }

    mouse_inside_graph_bounds(e) {
        var graph_bounds = this.get_graph_bounding_box();
        if (
            e.offsetX >= graph_bounds.x && e.offsetX <= graph_bounds.x + graph_bounds.width &&
            e.offsetY >= graph_bounds.y && e.offsetY <= graph_bounds.y + graph_bounds.height
        ) {
            return true
        } else {
            return false
        }
    }

    nudge_graph_larger() {
        var pre_resize_bounds, post_resize_bounds, upper_bound, resize_increment;
        upper_bound = 1;
        resize_increment = 0.05;
        pre_resize_bounds = this.get_graph_bounding_box();
        if (this.fill_proportion + resize_increment <= upper_bound) {
            this.scale_graph_to_fit(this.fill_proportion + resize_increment);
        }
        post_resize_bounds = this.get_graph_bounding_box();
        return {
            'pre': pre_resize_bounds,
            'post': post_resize_bounds
        }
    }

    nudge_graph_smaller() {
        var pre_resize_bounds, post_resize_bounds, lower_bound, resize_increment;
        lower_bound = 0.05;
        resize_increment = 0.05;
        pre_resize_bounds = this.get_graph_bounding_box();
        if (this.fill_proportion - 0.05 >= resize_increment) {
            this.scale_graph_to_fit(this.fill_proportion - resize_increment)
        }
        post_resize_bounds = this.get_graph_bounding_box();
        return {
            'pre': pre_resize_bounds,
            'post': post_resize_bounds
        }
    }

    updateGraph(e) {
        var horizontal_overflow, vertical_overflow;
        horizontal_overflow = this.graph_bounding_box.width * this.fill_proportion >= this.canvas_bounding_box.width;
        vertical_overflow = this.graph_bounding_box.height * this.fill_proportion >= this.canvas_bounding_box.height;
        if (horizontal_overflow || vertical_overflow) {
            this.scale_graph_to_fit(this.fill_proportion);
        }
        var win = document.querySelector('.graph-view');
        win.scrollTo(win.scrollWidth * this.scroll_proportion.left, win.scrollHeight * this.scroll_proportion.top)
        this.graph_bounding_box = this.get_graph_bounding_box();
        this.canvas_bounding_box = this.get_canvas_bounding_box();
    }

    createSVG() {
        var svg, svg_rect, container
        svg = d3.select('.graph-view')
            .append('svg')
            .attr('class', 'graph')
            .attr('height', '100%')
            .attr('width', '100%');
        svg_rect = document.querySelector('svg').getBoundingClientRect();
        svg
            .attr("viewBox", [0, 0, svg_rect.width, svg_rect.height]);
        this.appendDefs(svg);
        this.apply_select_boxes(svg);
        this.apply_zoom(svg);
        this.bind_scroll_updating();
        this.svg = svg;
        container = this.createContainer(svg);
        return container
    }

    createContainer(svg) {
        var container = svg
            .append('g')
            .attr('class', 'container');
        return container
    }

    appendDefs(svg) {
        var colors = ['black', 'orange', 'blue'];
        var svg = svg;
        colors.forEach(
            color => {
                svg.append("svg:defs").append("svg:marker")
                    .attr("id", `triangle_${color}`)
                    .attr("refX", 4)
                    .attr("refY", 4)
                    .attr("markerWidth", 8)
                    .attr("markerHeight", 8)
                    .attr("orient", "auto")
                    .append("path")
                    .attr("d", "M 1 0 8 4 1 8 1 4")
                    .attr("fill", color);
            }
        );
        svg.append("svg:defs").append("svg:marker")
            .attr("id", "reference_arc")
            .append("path")
            .attr("d", this.generate_arc());
    }

    associateVisualInformationWithGraphNodes() {
        this.props.graph.objects.forEach(function (d) {
                d.x = parseInt(Math.abs(d.text.x));
                d.y = parseInt(Math.abs(d.text.y));
                if ('ellipse' in d) {
                    d.color = d.ellipse.stroke;
                    if ('stroke-width' in d.ellipse) {
                        d.stroke_width = parseInt(d.ellipse['stroke-width'])
                    } else {
                        d.stroke_width = 1
                    }
                } else {
                    d.color = d.polygon.stroke;
                }
                d.name = d.title;
            }
        );
    }

    associateVisualInformationWithGraphEdges() {
        var self = this;
        this.props.graph.edges.forEach(function (d) {
            d.tail = self.props.graph.objects[d.tail];
            d.head = self.props.graph.objects[d.head];
            d.color = d.path.stroke;
        });
    }

    drawProjections(container) {
        var self = this;
        self.associateVisualInformationWithGraphEdges();
        var id = 0
        var edge = container.append('g')
            .attr('class', 'edge')
            .selectAll('line')
            .data(self.props.graph.edges)
            .enter()
            .append('line')
            .attr('id', function (d) {
                id += 1;
                return `p${id - 1}`
            })
            .attr('x1', function (d) {
                return d.tail.x
            })
            .attr('y1', function (d) {
                return d.tail.y
            })
            .attr('x2', function (d) {
                return d.head.x
            })
            .attr('y2', function (d) {
                return d.head.y
            })
            .attr('stroke-width', 1)
            .attr('stroke', function (d) {
                return d.color
            })
            .attr('marker-end', function (d) {
                var color = d.color;
                var color_map = {
                    '#000000': 'black',
                    '#ffa500': 'orange',
                    '#0000ff': 'blue'
                };
                color = color in color_map ? color_map[color] : color;
                return `url(#triangle_${color})`;
            });
        this.index.add_d3_group(edge, 'projection');
        this.edge = edge;
    }

    drawRecurrentProjections(container) {
        var self = this;
        var recurrent_projs = [];
        var id = 0;
        d3.selectAll('g.edge line')
            .each(function (e) {
                if (e.head === e.tail) {
                    recurrent_projs.push(e);
                }
            });
        var recurrent = container.append('g')
            .attr('class', 'recurrent')
            .selectAll('path')
            .data(recurrent_projs)
            .enter()
            .append('path')
            .attr('id', function (d) {
                id += 1;
                return `r${id - 1}`
            })
            .attr('d', ()=>{
                return self.generate_arc()
            })
            .attr('fill', 'white')
            .attr('fill-opacity', '0')
            .attr('stroke', 'black');
        self.recurrent = recurrent;
        self.index.add_d3_group(recurrent, 'projection');

        var recurrent_container = document.querySelector('g.recurrent');
        this.index.recurrent_projections.forEach(
            (projection) => {
                if (!(projection.dom.constructor.name === 'SVGPathElement')) {
                    recurrent_container.appendChild(projection.dom)
                }
            }
        )
    }

    drawNodes(container, nodeDragFunction) {
        var self = this;
        var nodeWidth = self.state.node_width;
        var nodeHeight = self.state.node_height;
        self.associateVisualInformationWithGraphNodes();
        var id = 0;
        var node = container.append('g')
            .attr('class', 'node')
            .selectAll('ellipse')
            .data(this.props.graph.objects)
            .enter()
            .append('ellipse')
            .attr('id', function (d) {
                id += 1;
                return `n${id - 1}`
            })
            .attr('rx', function (d) {
                d.rx = nodeWidth;
                return d.rx
            })
            .attr('ry', function (d) {
                d.ry = nodeHeight;
                return d.ry
            })
            .attr('cx', function (d) {
                return d.x
            })
            .attr('cy', function (d) {
                return d.y
            })
            .attr('fill', 'white')
            .attr('stroke-width', function (d) {
                d.stroke_width = d.stroke_width ? d.stroke_width : 1;
                return d.stroke_width
            })
            .attr('stroke', function (d) {
                return d.color
            })
            .attr('class', function () {
            })
            .call(d3.drag()
                .on('drag', nodeDragFunction)
                .on('end', ()=>{self.update_script()})
            )
            .on('click', (d) => {
                this.unselect_all();
                this.select_node(this.index.lookup(d))
            });
        this.index.add_d3_group(node, 'node');
        this.node = node
    }

    drawLabels(container, labelDragFunction) {
        var self = this;
        var offset_from_top_of_node = 3;
        var label = container.append('g')
            .attr('class', 'label')
            .selectAll('text')
            .data(this.props.graph.objects)
            .enter()
            .append('text')
            .attr("text-anchor", "middle")
            .attr('x', function (d) {
                return d.x
            })
            .attr('y', function (d) {
                return d.y + offset_from_top_of_node
            })
            .attr('font-size', function (d) {
                d.text['font-size'] = '10';
                return '10px'
            })
            .text(function (d) {
                return d.name
            })
            .call(d3.drag()
                .on('drag', labelDragFunction)
                .on('end', ()=>{self.update_script()})
            )
            .on('click', (d) => {
                this.unselect_all();
                this.select_node(this.index.lookup(d))
            });
        this.label = label;
        this.index.add_d3_group(label, 'label');
    }

    get_offset_between_ellipses(x1, y1, x2, y2, nodeXRad, nodeYRad, strokeWidth) {
        if (!strokeWidth) {
            strokeWidth = 1
        }
        var adjusted_x = x2 - x1;
        var adjusted_y = y2 - y1;
        var dist_between_centers = Math.sqrt(adjusted_x ** 2 + adjusted_y ** 2);
        var phi = Math.atan2(adjusted_y, adjusted_x);
        var a = parseFloat(nodeXRad) + strokeWidth;
        var b = parseFloat(nodeYRad) + strokeWidth;
        var radius_at_point = a * b / Math.sqrt(a ** 2 * Math.sin(phi) ** 2 + b ** 2 * Math.cos(phi) ** 2);
        var e_radius = dist_between_centers - radius_at_point - 3;
        var new_x = (e_radius * Math.cos(phi) + x1);
        var new_y = (e_radius * Math.sin(phi) + y1);
        return {
            x: new_x,
            y: new_y
        }
    }

    fit_graph_to_workspace() {
        var self = this;
        var view_rect = document.querySelector('.graph-view')
            .getBoundingClientRect();
        this.index.nodes.forEach(
            function (node) {
                node.data.x = (view_rect.width * 0.95) * (node.data.x / (self.props.graph.max_x));
                node.data.y += (view_rect.height * 0.95) * (node.data.y / (self.props.graph.max_y));
                node.selection
                    .attr('cx', node.data.x)
                    .attr('cy', node.data.y);
            }
        );
    }

    rad2deg(rad){
        return rad*180/Math.PI
    }

    deg2rad(deg){
        return deg*Math.PI/180
    }

    get_terminal_angles_of_arc(start_pt, end_pt, centerpoint){
        var start_angle, end_angle;
        start_angle = Math.atan2(start_pt.y-centerpoint.y, start_pt.x-centerpoint.x);
        end_angle = Math.atan2(end_pt.y-centerpoint.y, end_pt.x-centerpoint.x);
        return {
            start: start_angle,
            end: end_angle
        }
    }

    move_graph(dx = 0, dy = 0) {
        // var stylesheet, graph_rect;
        dx /= this.scaling_factor;
        dy /= this.scaling_factor;
        this.index.nodes.forEach(
            (node) => {
                node.data.x += dx;
                node.data.y += dy;
                node.selection
                    .attr('cx', node.data.x)
                    .attr('cy', node.data.y);
                this.move_label_to_corresponding_node(node);
                this.refresh_edges_for_node(node);
            }
        );
    }

    resize_nodes_to_label_text() {
        this.index.nodes.forEach(
            (node) => {
                var label_radius = Math.floor((node.label.dom.getBoundingClientRect().width / 2) + 10);
                node.data.rx = label_radius;
                node.selection.attr('rx', label_radius);
            }
        );
    }

    resize_recurrent_projections() {
        var r = this.recurrent
    }

    update_scroll() {
        var win = document.querySelector('.graph-view');
        this.scroll_proportion.left = win.scrollLeft / win.scrollWidth;
        this.scroll_proportion.top = win.scrollTop / win.scrollHeight;
    }

    apply_select_boxes() {
        var self = this;
        var svg = d3.select('svg');
        //TODO: On select, save rect of selected nodes for more efficient collision detection when dragging
        svg
            .on('mousedown', function () {
                    // don't fire if command is pressed. command unlocks different options
                    console.log('x',Math.round(d3.mouse(this)[0]/self.scaling_factor), 'y', Math.round(d3.mouse(this)[1]/self.scaling_factor))
                    if (!(d3.event.metaKey || d3.event.ctrlKey)) {
                        var anchor_pt = d3.mouse(this);
                        var processed_anchor_pt = [
                            {anchor: {x: anchor_pt[0], y: anchor_pt[1]}}
                        ];
                        self.unselect_all();
                        svg.append('rect')
                            .attr('rx', 6)
                            .attr('ry', 6)
                            .attr('class', 'selection')
                            .data(processed_anchor_pt);
                    }
                }
            )
            .on("mousemove", function () {
                var anchor_x, anchor_y, current_x, current_y;
                var s = svg.select("rect.selection");
                var current_pt = d3.mouse(this);
                s
                    .attr('x', (d) => {
                        anchor_x = d.anchor.x;
                        current_x = current_pt[0];
                        if (current_x > anchor_x) {
                            return anchor_x
                        } else {
                            return current_x
                        }
                    })
                    .attr('y', (d) => {
                        anchor_y = d.anchor.y;
                        current_y = current_pt[1];
                        if (current_y > anchor_y) {
                            return anchor_y
                        } else {
                            return current_y
                        }
                    })
                    .attr('width', (d) => {
                        anchor_x = d.anchor.x;
                        current_x = current_pt[0];
                        return Math.abs(anchor_x - current_x)
                    })
                    .attr('height', (d) => {
                        anchor_y = d.anchor.y;
                        current_y = current_pt[1];
                        return Math.abs(anchor_y - current_y)
                    });
                var selection_box = document.querySelector('rect.selection');
                if (selection_box) {
                    var selection_box_bounding_rect = selection_box.getBoundingClientRect();
                    var sel_x1, sel_y1, sel_x2, sel_y2;
                    sel_x1 = selection_box_bounding_rect.x;
                    sel_y1 = selection_box_bounding_rect.y;
                    sel_x2 = sel_x1 + selection_box_bounding_rect.width;
                    sel_y2 = sel_y1 + selection_box_bounding_rect.height;
                    self.index.nodes.forEach((node) => {
                        var node_rect = node.dom.getBoundingClientRect();
                        var node_x1, node_x2, node_y1, node_y2;
                        node_x1 = node_rect.x;
                        node_x2 = node_x1 + node_rect.width;
                        node_y1 = node_rect.y;
                        node_y2 = node_y1 + node_rect.height;
                        var sel_ul, sel_lr, node_ul, node_lr;
                        sel_ul = {x: sel_x1, y: sel_y1};
                        sel_lr = {x: sel_x2, y: sel_y2};
                        node_ul = {x: node_x1, y: node_y1};
                        node_lr = {x: node_x2, y: node_y2};
                        if (
                            sel_lr.x < node_ul.x ||
                            node_lr.x < sel_ul.x ||
                            sel_lr.y < node_ul.y ||
                            node_lr.y < sel_ul.y

                        ) {
                            self.unselect_node(node)
                        } else {
                            self.select_node(node)
                        }
                    })

                }
            })
            .on("mouseup", function () {
                // // Remove selection frame
                svg.selectAll("rect.selection").remove();
            })
            .on("mouseout", function () {
                // if mouse enters an area of the screen not belonging to the SVG or one of its child elements
                var toElement = d3.event.toElement;
                if (!toElement ||
                    !(toElement === svg.node() ||
                        ('ownerSVGElement' in toElement && toElement.ownerSVGElement === svg.node()))) {
                    svg.selectAll("rect.selection").remove();
                }
            })
    }

    select_node(node) {
        this.selected.add(node);
        node.selection.classed('selected', true);
    }

    unselect_node(node) {
        this.selected.delete(node);
        node.selection.classed('selected', false);
    }

    unselect_all() {
        this.index.nodes.forEach(
            (n) => {
                n.selection.classed('selected', false)
            }
        );
        this.selected = new Set()
    }

    correct_projection_lengths_for_ellipse_sizes() {
        var offset_pt, self;
        self = this;
        this.index.projections.forEach(
            (projection) => {
                offset_pt = self.get_offset_points_for_projection(projection);
                projection.selection
                    .attr('x2', offset_pt.x)
                    .attr('y2', offset_pt.y)
            }
        )
    }

    get_offset_points_for_projection(projection) {
        return this.get_offset_between_ellipses(projection.tail.data.x, projection.tail.data.y, projection.head.data.x, projection.head.data.y, projection.head.data.rx, projection.head.data.ry, Math.round(projection.head.stroke_width / 2))
    }

    node_movement_within_canvas_bounds(node, dx, dy) {
        var canvas_bounding_box = this.get_canvas_bounding_box();
        var node_dom_rect, node_width, stroke_width, node_height, x_shift, y_shift;
        node_dom_rect = node.dom.getBoundingClientRect();
        node_width = node_dom_rect.width;
        node_height = node_dom_rect.height;
        stroke_width = node.data.stroke_width;
        x_shift = dx * this.scaling_factor;
        y_shift = dy * this.scaling_factor;
        return (
            {
                x: (node_dom_rect.x - stroke_width + x_shift >= canvas_bounding_box.x &&
                    node_dom_rect.x + node_width + stroke_width + x_shift <= canvas_bounding_box.right),
                y: (node_dom_rect.y - stroke_width + y_shift >= canvas_bounding_box.y &&
                    node_dom_rect.y + node_height + stroke_width + y_shift <= canvas_bounding_box.bottom),
            }
        );
    }

    move_nodes(dx, dy) {
        var in_bounds;
        var self = this;
        self.selected.forEach(
            (s) => {
                in_bounds = self.node_movement_within_canvas_bounds(s, dx, dy);
                if (!in_bounds.x) {
                    dx = 0
                }
                if (!in_bounds.y) {
                    dy = 0
                }
            }
        );
        self.selected.forEach(
            (s) => {
                self.move_node(s, dx, dy)
            }
        )
    }

    move_node(node, dx, dy) {
        node.data.x += dx;
        node.data.y += dy;
        node.data.x = +(node.data.x*this.scaling_factor).toFixed(0)/this.scaling_factor;
        node.data.y = +(node.data.y*this.scaling_factor).toFixed(0)/this.scaling_factor;
        node.selection
            .attr('cx', node.data.x)
            .attr('cy', node.data.y);
        this.stylesheet.components.nodes[node.name] =
            {
                'x': +((node.data.x - node.data.rx) * this.scaling_factor).toFixed(0) - node.data.stroke_width,
                'y': +((node.data.y - node.data.ry) * this.scaling_factor).toFixed(0) - node.data.stroke_width
            };
        this.move_label_to_corresponding_node(node);
        this.refresh_edges_for_node(node);
    }

    move_label_to_corresponding_node(node) {
        var offset_from_top_of_node = 3;
        node.label.selection
            .attr('x', node.data.x)
            .attr('y', node.data.y + offset_from_top_of_node);
    }

    gen_arc(phi1, phi2, innerRad, outerRad){
        return d3.arc()
            .startAngle(phi1)
            .endAngle(phi2)
            .innerRadius(innerRad)
            .outerRadius(outerRad)()
    }

    CalculateCircleCenter(A,B,C)
    {
        var ax = (A.x + B.x)/2,
            ay = (A.y + B.y)/2,
            ux = (A.y - B.y),
            uy = (B.x - A.x),
            bx = (B.x + C.x)/2,
            by = (B.y + C.y)/2,
            vx = (B.y - C.y),
            vy = (C.x - B.x),
            dx = ax - bx,
            dy = ay - by,
            vu = vx * uy - vy * ux,
            g = (dx * uy - dy * ux) / vu,
            center = {
                x:bx + g * vx,
                y:by + g * vy
            };
        if (vu == 0)
            return false; // Points are collinear, so no unique solution
        return center;
    }
    refresh_edges_for_node(node) {
        var self, offset_pt, recurrent_projs;
        recurrent_projs = new Set();
        self = this;
        node.efferents.forEach(
            (projection) => {
                offset_pt = self.get_offset_points_for_projection(projection);
                projection.selection
                    .attr('x1', projection.data.tail.x)
                    .attr('y1', projection.data.tail.y)
                    .attr('x2', offset_pt.x)
                    .attr('y2', offset_pt.y);
                if (projection.is_recurrent()) {
                    recurrent_projs.add(projection)
                }
            }
        );
        node.afferents.forEach(
            (projection) => {
                offset_pt = self.get_offset_points_for_projection(projection);
                projection.selection
                    .attr('x2', offset_pt.x)
                    .attr('y2', offset_pt.y);
                if (projection.is_recurrent()) {
                    recurrent_projs.add(projection)
                }
            }
        );

        this.index.recurrent_projections.forEach(
            (projection) => {
                var phi = -2;
                var xrad = projection.head.data.rx;
                var yrad = projection.head.data.ry;
                var radius_at_point = xrad * yrad / Math.sqrt(xrad ** 2 * Math.sin(phi) ** 2 + yrad ** 2 * Math.cos(phi) ** 2);
                var stpt = {
                    x: radius_at_point * Math.cos(phi),
                    y: radius_at_point * Math.sin(phi)
                };
                var endpt = {
                    x: stpt.x,
                    y: stpt.y * -1
                };
                var lftedge = {
                    x: -projection.head.data.rx-10,
                    y: 0
                };
                var ctpt = this.CalculateCircleCenter(stpt, endpt, lftedge);
                var radius = ctpt.x - lftedge.x;
                if (projection.dom.constructor.name === 'SVGPathElement') {
                    var arc_start_angle = Math.atan2(stpt.y-ctpt.y, stpt.x-ctpt.x);
                    var arc_end_angle = Math.atan2(endpt.y-ctpt.y, endpt.x-ctpt.x);
                    var test_arc = this.gen_arc(arc_end_angle, 2*Math.PI+arc_start_angle,  radius, radius)
                    var path = test_arc.toString()
                    projection.selection.attr('d',path);
                    projection.selection
                        .attr('transform', `translate(${projection.data.head.x+ctpt.x},${projection.data.head.y}) rotate(90)`)
                } else {
                    var circ = 2 * Math.PI * radius;
                    var rad_per_px = 2*Math.PI/circ;
                    var adjustment = 4;
                    var arc_end_angle = Math.atan2(stpt.y-ctpt.y, stpt.x-ctpt.x)-(rad_per_px*adjustment);
                    var x1 = (radius * Math.cos(arc_end_angle-0.01));
                    var y1 = (radius * Math.sin(arc_end_angle-0.01));
                    var x2 = (radius * Math.cos(arc_end_angle));
                    var y2 = (radius * Math.sin(arc_end_angle));
                    projection.selection
                        .attr('x1', projection.data.head.x+ctpt.x+x1)
                        .attr('y1', projection.data.head.y-y1)
                        .attr('x2', projection.data.head.x+ctpt.x+x2)
                        .attr('y2', projection.data.head.y-y2)
                }
            }
        );
    }

    scroll_graph_into_view() {
        var horizontal_offset, vertical_offset, graph_bounding_box;
        graph_bounding_box = this.get_graph_bounding_box();
        if (graph_bounding_box.x < 0) {
            horizontal_offset = Math.abs(0 - graph_bounding_box.x)
        } else {
            horizontal_offset = 0
        }
        if (graph_bounding_box.y < 0) {
            vertical_offset = Math.abs(0 - graph_bounding_box.y)
        } else {
            vertical_offset = 0
        }
        this.move_graph(horizontal_offset, vertical_offset)
    }

    scale_graph(scaling_factor) {
        var node_selector, label_selector, edge_selector, recurrent_selector;
        this.scaling_factor = scaling_factor;
        node_selector = d3.select('g.node');
        node_selector
            .attr('transform', `scale(${scaling_factor})`);
        label_selector = d3.select('g.label');
        label_selector
            .attr('transform', `scale(${scaling_factor})`);
        edge_selector = d3.select('g.edge');
        edge_selector
            .attr('transform', `scale(${scaling_factor})`);
        recurrent_selector = d3.select('g.recurrent');
        recurrent_selector
            .attr('transform', `scale(${scaling_factor})`);
    }

    scale_graph_to_fit(proportion) {
        var canvas_bounding_box, graph_bounding_box, target_width, target_height, scaling_factor;
        this.fill_proportion = proportion;
        this.scale_graph(1);
        canvas_bounding_box = this.get_canvas_bounding_box();
        graph_bounding_box = this.get_graph_bounding_box();
        target_width = Math.floor(canvas_bounding_box.width * proportion * .99);
        target_height = Math.floor(canvas_bounding_box.height * proportion * .99);
        scaling_factor = Math.min(
            Math.floor(((target_width / graph_bounding_box.width) * 100)) / 100,
            Math.floor(((target_height / graph_bounding_box.height) * 100)) / 100,
        );
        this.scale_graph(scaling_factor);
        this.center_graph_on_point();
    }

    get_canvas_bounding_box() {
        var canvas_rect = document.querySelector('.graph').getBoundingClientRect();
        return canvas_rect;
    }

    get_graph_bounding_box() {
        var g_container, graph_rect, canvas_rect, x, y, width, height, centerpoint;
        g_container = document.querySelector('g.container');
        graph_rect = g_container.getBoundingClientRect();
        canvas_rect = this.get_canvas_bounding_box()
        x = graph_rect.x - canvas_rect.x;
        y = graph_rect.y - canvas_rect.y;
        width = graph_rect.width;
        height = graph_rect.height;
        centerpoint = {
            x: width / 2 + x,
            y: height / 2 + y
        };
        return {
            x: x,
            y: y,
            width: width,
            height: height,
            centerpoint: centerpoint
        }
    }

    center_graph_on_point(centerpoint_offset = this.centerpoint_offset) {
        var centerpoint, graph_bounding_box, canvas_bounding_box, vertical_offset, horizontal_offset;
        graph_bounding_box = this.get_graph_bounding_box();
        canvas_bounding_box = this.get_canvas_bounding_box();
        centerpoint = {x: canvas_bounding_box.width / 2, y: canvas_bounding_box.height / 2};
        horizontal_offset = centerpoint.x - graph_bounding_box.centerpoint.x + centerpoint_offset.x;
        vertical_offset = centerpoint.y - graph_bounding_box.centerpoint.y + centerpoint_offset.y;
        this.move_graph(horizontal_offset, vertical_offset)
    }

    zoomed() {
        var d3e = d3.select('svg.graph');
        var win = document.querySelector('.graph-view')
        if (d3.event.sourceEvent && d3.event.sourceEvent.type === 'mousemove') {
            if (d3.event.sourceEvent.metaKey || d3.event.sourceEvent.ctrlKey) {
                var xScroll = win.scrollLeft - d3.event.sourceEvent.movementX;
                var yScroll = win.scrollTop - d3.event.sourceEvent.movementY;
            } else {
                var xScroll = win.scrollLeft;
                var yScroll = win.scrollTop;
            }
        } else {
            var full_g_pre = document.querySelector('svg.graph');
            var full_g_box_pre = full_g_pre.getBoundingClientRect();
            var pre_scale_x_proportion = this.mouse_offset.x / full_g_box_pre.width;
            var pre_scale_y_proportion = this.mouse_offset.y / full_g_box_pre.height;
            var new_scale = 100 * d3.event.transform.k;
            d3e
                .attr('width', `${new_scale}%`)
                .attr('height', `${new_scale}%`);
            var full_g_post = document.querySelector('svg.graph');
            var full_g_box_post = full_g_post.getBoundingClientRect();
            var xScrollOffset = full_g_box_post.width * pre_scale_x_proportion - this.mouse_offset.x;
            var xScroll = win.scrollLeft + xScrollOffset;
            var yScrollOffset = full_g_box_post.height * pre_scale_y_proportion - this.mouse_offset.y;
            var yScroll = win.scrollTop + yScrollOffset;
        }
        win.scrollTo(xScroll, yScroll)
    }

    apply_zoom(svg) {
        var zoom = d3.zoom();
        this.zoom = zoom
            .scaleExtent([1, 3])
            .filter(() => {
                return d3.event.type.includes("mouse")
                    && (
                        d3.event.ctrlKey
                        || d3.event.metaKey
                        || (d3.event.sourceEvent && !d3.event.sourceEvent.type === "wheel")
                    )
            });
        var d3e = d3.select('svg.graph');
        d3e.call(this.zoom
            .on("zoom", this.zoomed)
        );
    }

    bind_scroll_updating() {
        var win = document.querySelector('.graph-view');
        win.addEventListener('scroll', this.update_scroll);
    }

    parse_stylesheet() {
        var self, hash, stylesheet, x_coord, y_coord, leftmost_node, topmost_node;
        self = this;
        stylesheet = this.props.graph_style;
        this.stylesheet = stylesheet;
        if ('graph' in stylesheet) {
        }
        if ('components' in stylesheet) {
            if ('nodes' in stylesheet.components) {
                var pnlv_node, nodes, cx, cy;
                nodes = Object.keys(stylesheet.components.nodes);
                nodes.forEach(
                    (node) => {
                        pnlv_node = self.index.lookup(node);
                        cx = (stylesheet.components.nodes[node].x/this.scaling_factor) + pnlv_node.data.rx + pnlv_node.data.stroke_width/this.scaling_factor;
                        cy = (stylesheet.components.nodes[node].y/this.scaling_factor) + pnlv_node.data.ry + pnlv_node.data.stroke_width/this.scaling_factor;
                        pnlv_node.data.x = cx;
                        pnlv_node.data.y = cy;
                        pnlv_node.selection
                            .attr('cx', pnlv_node.data.x)
                            .attr('cy', pnlv_node.data.y);
                        self.move_label_to_corresponding_node(pnlv_node);
                        self.refresh_edges_for_node(pnlv_node);
                    }
                )
            }
        }
    }

    setGraph() {
        var self = this;
        if (self.props.graph) {
            window.rpc = self.props.rpc_client;
            this.script_updater = this.props.rpc_client.update_stylesheet();
            var container = this.createSVG();
            this.index = new Index();
            this.drawProjections(container);
            this.drawNodes(container, (d) => {
                var origin_drag_node;
                origin_drag_node = this.index.lookup(d);
                if (!self.selected.has(origin_drag_node)) {
                    self.unselect_all();
                    self.select_node(origin_drag_node);
                }
                self.move_nodes(d3.event.dx, d3.event.dy)
            });
            this.drawLabels(container, (d) => {
                var origin_drag_node;
                origin_drag_node = this.index.lookup(d);
                if (!self.selected.has(origin_drag_node)) {
                    self.unselect_all();
                    self.select_node(origin_drag_node);
                }
                self.move_nodes(d3.event.dx, d3.event.dy)
            });
            this.drawRecurrentProjections(container);
            this.resize_nodes_to_label_text();
            this.resize_recurrent_projections();
            this.scale_graph_to_fit(this.fill_proportion);
            this.correct_projection_lengths_for_ellipse_sizes();
            // this.center_graph_on_point();
            this.parse_stylesheet();
            this.graph_bounding_box = this.get_graph_bounding_box();
            this.canvas_bounding_box = this.get_canvas_bounding_box();
            window.index = this.index;
            window.this = this;
        }
    }

    render() {
        return (
            <Resizable
                style={style}
                onResize={this.props.onResize}
                onResizeStart={this.props.onResizeStart}
                onResizeStop={this.props.onResizeStop}
                enable={{
                    top: false,
                    right: false,
                    bottom: true,
                    left: true,
                    topRight: false,
                    bottomRight: false,
                    bottomLeft: true,
                    topLeft: false
                }}
                className='graphview'
                defaultSize={
                    this.props.defaultSize
                }
                size={
                    this.props.size
                }
            >
                <div className={this.state.class}/>
                <div className={'spinner'}
                     style={
                         {
                             "position": "absolute",
                         }
                     }
                >
                    {
                        this.state.spinner_visible ?
                            <Spinner
                                className={"graph_loading_spinner"}/> :
                            <div/>
                    }
                </div>
            </Resizable>
        )
    }
}

export default GraphView
