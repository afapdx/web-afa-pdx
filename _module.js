function noop() { }
const identity = x => x;
function assign(tar, src) {
    // @ts-ignore
    for (const k in src)
        tar[k] = src[k];
    return tar;
}
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
let src_url_equal_anchor;
function src_url_equal(element_src, url) {
    if (!src_url_equal_anchor) {
        src_url_equal_anchor = document.createElement('a');
    }
    src_url_equal_anchor.href = url;
    return element_src === src_url_equal_anchor.href;
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function exclude_internal_props(props) {
    const result = {};
    for (const k in props)
        if (k[0] !== '$')
            result[k] = props[k];
    return result;
}
function null_to_empty(value) {
    return value == null ? '' : value;
}

const is_client = typeof window !== 'undefined';
let now = is_client
    ? () => window.performance.now()
    : () => Date.now();
let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

const tasks = new Set();
function run_tasks(now) {
    tasks.forEach(task => {
        if (!task.c(now)) {
            tasks.delete(task);
            task.f();
        }
    });
    if (tasks.size !== 0)
        raf(run_tasks);
}
/**
 * Creates a new task that runs on each raf frame
 * until it returns a falsy value or is aborted
 */
function loop(callback) {
    let task;
    if (tasks.size === 0)
        raf(run_tasks);
    return {
        promise: new Promise(fulfill => {
            tasks.add(task = { c: callback, f: fulfill });
        }),
        abort() {
            tasks.delete(task);
        }
    };
}

// Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
// at the end of hydration without touching the remaining nodes.
let is_hydrating = false;
function start_hydrating() {
    is_hydrating = true;
}
function end_hydrating() {
    is_hydrating = false;
}
function upper_bound(low, high, key, value) {
    // Return first index of value larger than input value in the range [low, high)
    while (low < high) {
        const mid = low + ((high - low) >> 1);
        if (key(mid) <= value) {
            low = mid + 1;
        }
        else {
            high = mid;
        }
    }
    return low;
}
function init_hydrate(target) {
    if (target.hydrate_init)
        return;
    target.hydrate_init = true;
    // We know that all children have claim_order values since the unclaimed have been detached if target is not <head>
    let children = target.childNodes;
    // If target is <head>, there may be children without claim_order
    if (target.nodeName === 'HEAD') {
        const myChildren = [];
        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            if (node.claim_order !== undefined) {
                myChildren.push(node);
            }
        }
        children = myChildren;
    }
    /*
    * Reorder claimed children optimally.
    * We can reorder claimed children optimally by finding the longest subsequence of
    * nodes that are already claimed in order and only moving the rest. The longest
    * subsequence of nodes that are claimed in order can be found by
    * computing the longest increasing subsequence of .claim_order values.
    *
    * This algorithm is optimal in generating the least amount of reorder operations
    * possible.
    *
    * Proof:
    * We know that, given a set of reordering operations, the nodes that do not move
    * always form an increasing subsequence, since they do not move among each other
    * meaning that they must be already ordered among each other. Thus, the maximal
    * set of nodes that do not move form a longest increasing subsequence.
    */
    // Compute longest increasing subsequence
    // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
    const m = new Int32Array(children.length + 1);
    // Predecessor indices + 1
    const p = new Int32Array(children.length);
    m[0] = -1;
    let longest = 0;
    for (let i = 0; i < children.length; i++) {
        const current = children[i].claim_order;
        // Find the largest subsequence length such that it ends in a value less than our current value
        // upper_bound returns first greater value, so we subtract one
        // with fast path for when we are on the current longest subsequence
        const seqLen = ((longest > 0 && children[m[longest]].claim_order <= current) ? longest + 1 : upper_bound(1, longest, idx => children[m[idx]].claim_order, current)) - 1;
        p[i] = m[seqLen] + 1;
        const newLen = seqLen + 1;
        // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
        m[newLen] = i;
        longest = Math.max(newLen, longest);
    }
    // The longest increasing subsequence of nodes (initially reversed)
    const lis = [];
    // The rest of the nodes, nodes that will be moved
    const toMove = [];
    let last = children.length - 1;
    for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
        lis.push(children[cur - 1]);
        for (; last >= cur; last--) {
            toMove.push(children[last]);
        }
        last--;
    }
    for (; last >= 0; last--) {
        toMove.push(children[last]);
    }
    lis.reverse();
    // We sort the nodes being moved to guarantee that their insertion order matches the claim order
    toMove.sort((a, b) => a.claim_order - b.claim_order);
    // Finally, we move the nodes
    for (let i = 0, j = 0; i < toMove.length; i++) {
        while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
            j++;
        }
        const anchor = j < lis.length ? lis[j] : null;
        target.insertBefore(toMove[i], anchor);
    }
}
function append(target, node) {
    target.appendChild(node);
}
function get_root_for_style(node) {
    if (!node)
        return document;
    const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
    if (root && root.host) {
        return root;
    }
    return node.ownerDocument;
}
function append_empty_stylesheet(node) {
    const style_element = element('style');
    append_stylesheet(get_root_for_style(node), style_element);
    return style_element.sheet;
}
function append_stylesheet(node, style) {
    append(node.head || node, style);
    return style.sheet;
}
function append_hydration(target, node) {
    if (is_hydrating) {
        init_hydrate(target);
        if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentNode !== target))) {
            target.actual_end_child = target.firstChild;
        }
        // Skip nodes of undefined ordering
        while ((target.actual_end_child !== null) && (target.actual_end_child.claim_order === undefined)) {
            target.actual_end_child = target.actual_end_child.nextSibling;
        }
        if (node !== target.actual_end_child) {
            // We only insert if the ordering of this node should be modified or the parent node is not target
            if (node.claim_order !== undefined || node.parentNode !== target) {
                target.insertBefore(node, target.actual_end_child);
            }
        }
        else {
            target.actual_end_child = node.nextSibling;
        }
    }
    else if (node.parentNode !== target || node.nextSibling !== null) {
        target.appendChild(node);
    }
}
function insert_hydration(target, node, anchor) {
    if (is_hydrating && !anchor) {
        append_hydration(target, node);
    }
    else if (node.parentNode !== target || node.nextSibling != anchor) {
        target.insertBefore(node, anchor || null);
    }
}
function detach(node) {
    if (node.parentNode) {
        node.parentNode.removeChild(node);
    }
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function svg_element(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
/**
 * List of attributes that should always be set through the attr method,
 * because updating them through the property setter doesn't work reliably.
 * In the example of `width`/`height`, the problem is that the setter only
 * accepts numeric values, but the attribute can also be set to a string like `50%`.
 * If this list becomes too big, rethink this approach.
 */
const always_set_through_set_attribute = ['width', 'height'];
function set_attributes(node, attributes) {
    // @ts-ignore
    const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
    for (const key in attributes) {
        if (attributes[key] == null) {
            node.removeAttribute(key);
        }
        else if (key === 'style') {
            node.style.cssText = attributes[key];
        }
        else if (key === '__value') {
            node.value = node[key] = attributes[key];
        }
        else if (descriptors[key] && descriptors[key].set && always_set_through_set_attribute.indexOf(key) === -1) {
            node[key] = attributes[key];
        }
        else {
            attr(node, key, attributes[key]);
        }
    }
}
function set_svg_attributes(node, attributes) {
    for (const key in attributes) {
        attr(node, key, attributes[key]);
    }
}
function children(element) {
    return Array.from(element.childNodes);
}
function init_claim_info(nodes) {
    if (nodes.claim_info === undefined) {
        nodes.claim_info = { last_index: 0, total_claimed: 0 };
    }
}
function claim_node(nodes, predicate, processNode, createNode, dontUpdateLastIndex = false) {
    // Try to find nodes in an order such that we lengthen the longest increasing subsequence
    init_claim_info(nodes);
    const resultNode = (() => {
        // We first try to find an element after the previous one
        for (let i = nodes.claim_info.last_index; i < nodes.length; i++) {
            const node = nodes[i];
            if (predicate(node)) {
                const replacement = processNode(node);
                if (replacement === undefined) {
                    nodes.splice(i, 1);
                }
                else {
                    nodes[i] = replacement;
                }
                if (!dontUpdateLastIndex) {
                    nodes.claim_info.last_index = i;
                }
                return node;
            }
        }
        // Otherwise, we try to find one before
        // We iterate in reverse so that we don't go too far back
        for (let i = nodes.claim_info.last_index - 1; i >= 0; i--) {
            const node = nodes[i];
            if (predicate(node)) {
                const replacement = processNode(node);
                if (replacement === undefined) {
                    nodes.splice(i, 1);
                }
                else {
                    nodes[i] = replacement;
                }
                if (!dontUpdateLastIndex) {
                    nodes.claim_info.last_index = i;
                }
                else if (replacement === undefined) {
                    // Since we spliced before the last_index, we decrease it
                    nodes.claim_info.last_index--;
                }
                return node;
            }
        }
        // If we can't find any matching node, we create a new one
        return createNode();
    })();
    resultNode.claim_order = nodes.claim_info.total_claimed;
    nodes.claim_info.total_claimed += 1;
    return resultNode;
}
function claim_element_base(nodes, name, attributes, create_element) {
    return claim_node(nodes, (node) => node.nodeName === name, (node) => {
        const remove = [];
        for (let j = 0; j < node.attributes.length; j++) {
            const attribute = node.attributes[j];
            if (!attributes[attribute.name]) {
                remove.push(attribute.name);
            }
        }
        remove.forEach(v => node.removeAttribute(v));
        return undefined;
    }, () => create_element(name));
}
function claim_element(nodes, name, attributes) {
    return claim_element_base(nodes, name, attributes, element);
}
function claim_svg_element(nodes, name, attributes) {
    return claim_element_base(nodes, name, attributes, svg_element);
}
function claim_text(nodes, data) {
    return claim_node(nodes, (node) => node.nodeType === 3, (node) => {
        const dataStr = '' + data;
        if (node.data.startsWith(dataStr)) {
            if (node.data.length !== dataStr.length) {
                return node.splitText(dataStr.length);
            }
        }
        else {
            node.data = dataStr;
        }
    }, () => text(data), true // Text nodes should not update last index since it is likely not worth it to eliminate an increasing subsequence of actual elements
    );
}
function claim_space(nodes) {
    return claim_text(nodes, ' ');
}
function set_data(text, data) {
    data = '' + data;
    if (text.data === data)
        return;
    text.data = data;
}
function set_style(node, key, value, important) {
    if (value == null) {
        node.style.removeProperty(key);
    }
    else {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}
function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, bubbles, cancelable, detail);
    return e;
}
function head_selector(nodeId, head) {
    const result = [];
    let started = 0;
    for (const node of head.childNodes) {
        if (node.nodeType === 8 /* comment node */) {
            const comment = node.textContent.trim();
            if (comment === `HEAD_${nodeId}_END`) {
                started -= 1;
                result.push(node);
            }
            else if (comment === `HEAD_${nodeId}_START`) {
                started += 1;
                result.push(node);
            }
        }
        else if (started > 0) {
            result.push(node);
        }
    }
    return result;
}

// we need to store the information for multiple documents because a Svelte application could also contain iframes
// https://github.com/sveltejs/svelte/issues/3624
const managed_styles = new Map();
let active = 0;
// https://github.com/darkskyapp/string-hash/blob/master/index.js
function hash(str) {
    let hash = 5381;
    let i = str.length;
    while (i--)
        hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
    return hash >>> 0;
}
function create_style_information(doc, node) {
    const info = { stylesheet: append_empty_stylesheet(node), rules: {} };
    managed_styles.set(doc, info);
    return info;
}
function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
    const step = 16.666 / duration;
    let keyframes = '{\n';
    for (let p = 0; p <= 1; p += step) {
        const t = a + (b - a) * ease(p);
        keyframes += p * 100 + `%{${fn(t, 1 - t)}}\n`;
    }
    const rule = keyframes + `100% {${fn(b, 1 - b)}}\n}`;
    const name = `__svelte_${hash(rule)}_${uid}`;
    const doc = get_root_for_style(node);
    const { stylesheet, rules } = managed_styles.get(doc) || create_style_information(doc, node);
    if (!rules[name]) {
        rules[name] = true;
        stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
    }
    const animation = node.style.animation || '';
    node.style.animation = `${animation ? `${animation}, ` : ''}${name} ${duration}ms linear ${delay}ms 1 both`;
    active += 1;
    return name;
}
function delete_rule(node, name) {
    const previous = (node.style.animation || '').split(', ');
    const next = previous.filter(name
        ? anim => anim.indexOf(name) < 0 // remove specific animation
        : anim => anim.indexOf('__svelte') === -1 // remove all Svelte animations
    );
    const deleted = previous.length - next.length;
    if (deleted) {
        node.style.animation = next.join(', ');
        active -= deleted;
        if (!active)
            clear_rules();
    }
}
function clear_rules() {
    raf(() => {
        if (active)
            return;
        managed_styles.forEach(info => {
            const { ownerNode } = info.stylesheet;
            // there is no ownerNode if it runs on jsdom.
            if (ownerNode)
                detach(ownerNode);
        });
        managed_styles.clear();
    });
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
/**
 * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
 * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
 * it can be called from an external module).
 *
 * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
 *
 * https://svelte.dev/docs#run-time-svelte-onmount
 */
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
/**
 * Schedules a callback to run immediately before the component is unmounted.
 *
 * Out of `onMount`, `beforeUpdate`, `afterUpdate` and `onDestroy`, this is the
 * only one that runs inside a server-side component.
 *
 * https://svelte.dev/docs#run-time-svelte-ondestroy
 */
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
/**
 * Creates an event dispatcher that can be used to dispatch [component events](/docs#template-syntax-component-directives-on-eventname).
 * Event dispatchers are functions that can take two arguments: `name` and `detail`.
 *
 * Component events created with `createEventDispatcher` create a
 * [CustomEvent](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent).
 * These events do not [bubble](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_bubbling_and_capture).
 * The `detail` argument corresponds to the [CustomEvent.detail](https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent/detail)
 * property and can contain any type of data.
 *
 * https://svelte.dev/docs#run-time-svelte-createeventdispatcher
 */
function createEventDispatcher() {
    const component = get_current_component();
    return (type, detail, { cancelable = false } = {}) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail, { cancelable });
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
            return !event.defaultPrevented;
        }
        return true;
    };
}

const dirty_components = [];
const binding_callbacks = [];
let render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = /* @__PURE__ */ Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();
let flushidx = 0; // Do *not* move this inside the flush() function
function flush() {
    // Do not reenter flush while dirty components are updated, as this can
    // result in an infinite loop. Instead, let the inner flush handle it.
    // Reentrancy is ok afterwards for bindings etc.
    if (flushidx !== 0) {
        return;
    }
    const saved_component = current_component;
    do {
        // first, call beforeUpdate functions
        // and update components
        try {
            while (flushidx < dirty_components.length) {
                const component = dirty_components[flushidx];
                flushidx++;
                set_current_component(component);
                update(component.$$);
            }
        }
        catch (e) {
            // reset dirty state to not end up in a deadlocked state and then rethrow
            dirty_components.length = 0;
            flushidx = 0;
            throw e;
        }
        set_current_component(null);
        dirty_components.length = 0;
        flushidx = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    seen_callbacks.clear();
    set_current_component(saved_component);
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
/**
 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
 */
function flush_render_callbacks(fns) {
    const filtered = [];
    const targets = [];
    render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
    targets.forEach((c) => c());
    render_callbacks = filtered;
}

let promise;
function wait() {
    if (!promise) {
        promise = Promise.resolve();
        promise.then(() => {
            promise = null;
        });
    }
    return promise;
}
function dispatch(node, direction, kind) {
    node.dispatchEvent(custom_event(`${direction ? 'intro' : 'outro'}${kind}`));
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
    else if (callback) {
        callback();
    }
}
const null_transition = { duration: 0 };
function create_bidirectional_transition(node, fn, params, intro) {
    const options = { direction: 'both' };
    let config = fn(node, params, options);
    let t = intro ? 0 : 1;
    let running_program = null;
    let pending_program = null;
    let animation_name = null;
    function clear_animation() {
        if (animation_name)
            delete_rule(node, animation_name);
    }
    function init(program, duration) {
        const d = (program.b - t);
        duration *= Math.abs(d);
        return {
            a: t,
            b: program.b,
            d,
            duration,
            start: program.start,
            end: program.start + duration,
            group: program.group
        };
    }
    function go(b) {
        const { delay = 0, duration = 300, easing = identity, tick = noop, css } = config || null_transition;
        const program = {
            start: now() + delay,
            b
        };
        if (!b) {
            // @ts-ignore todo: improve typings
            program.group = outros;
            outros.r += 1;
        }
        if (running_program || pending_program) {
            pending_program = program;
        }
        else {
            // if this is an intro, and there's a delay, we need to do
            // an initial tick and/or apply CSS animation immediately
            if (css) {
                clear_animation();
                animation_name = create_rule(node, t, b, duration, delay, easing, css);
            }
            if (b)
                tick(0, 1);
            running_program = init(program, duration);
            add_render_callback(() => dispatch(node, b, 'start'));
            loop(now => {
                if (pending_program && now > pending_program.start) {
                    running_program = init(pending_program, duration);
                    pending_program = null;
                    dispatch(node, running_program.b, 'start');
                    if (css) {
                        clear_animation();
                        animation_name = create_rule(node, t, running_program.b, running_program.duration, 0, easing, config.css);
                    }
                }
                if (running_program) {
                    if (now >= running_program.end) {
                        tick(t = running_program.b, 1 - t);
                        dispatch(node, running_program.b, 'end');
                        if (!pending_program) {
                            // we're done
                            if (running_program.b) {
                                // intro — we can tidy up immediately
                                clear_animation();
                            }
                            else {
                                // outro — needs to be coordinated
                                if (!--running_program.group.r)
                                    run_all(running_program.group.c);
                            }
                        }
                        running_program = null;
                    }
                    else if (now >= running_program.start) {
                        const p = now - running_program.start;
                        t = running_program.a + running_program.d * easing(p / running_program.duration);
                        tick(t, 1 - t);
                    }
                }
                return !!(running_program || pending_program);
            });
        }
    }
    return {
        run(b) {
            if (is_function(config)) {
                wait().then(() => {
                    // @ts-ignore
                    config = config(options);
                    go(b);
                });
            }
            else {
                go(b);
            }
        },
        end() {
            clear_animation();
            running_program = pending_program = null;
        }
    };
}

function get_spread_update(levels, updates) {
    const update = {};
    const to_null_out = {};
    const accounted_for = { $$scope: 1 };
    let i = levels.length;
    while (i--) {
        const o = levels[i];
        const n = updates[i];
        if (n) {
            for (const key in o) {
                if (!(key in n))
                    to_null_out[key] = 1;
            }
            for (const key in n) {
                if (!accounted_for[key]) {
                    update[key] = n[key];
                    accounted_for[key] = 1;
                }
            }
            levels[i] = n;
        }
        else {
            for (const key in o) {
                accounted_for[key] = 1;
            }
        }
    }
    for (const key in to_null_out) {
        if (!(key in update))
            update[key] = undefined;
    }
    return update;
}
function create_component(block) {
    block && block.c();
}
function claim_component(block, parent_nodes) {
    block && block.l(parent_nodes);
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
            // if the component was destroyed immediately
            // it will update the `$$.on_destroy` reference to `null`.
            // the destructured on_destroy may still reference to the old array
            if (component.$$.on_destroy) {
                component.$$.on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        flush_render_callbacks($$.after_update);
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: [],
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false,
        root: options.target || parent_component.$$.root
    };
    append_styles && append_styles($$.root);
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            start_hydrating();
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        end_hydrating();
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        if (!is_function(callback)) {
            return noop;
        }
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

/* generated by Svelte v3.58.0 */

function create_fragment(ctx) {
	let meta;
	let link0;
	let link1;
	let style;
	let t;

	return {
		c() {
			meta = element("meta");
			link0 = element("link");
			link1 = element("link");
			style = element("style");
			t = text("@import url(\"https://unpkg.com/@primo-app/primo@1.3.64/reset.css\");\n@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');\nhr {\n    border-top-width: 4px;\n    border-color: #194027;\n  border-style: dotted;\n}\n:root {\n  --verd-fosc: #194027;\n  --verd-clar:  #388762;\n  --taronja: #ff7f3f;\n  --lila-fosc: #dac9fa;\n  --lila: #e8e1fd;\n  --verd-fluor: #f3f7a5;\n  --crema: #fff5eb;\n  \n  --background: var(--crema);\n\n  --color-accent: var(--verd-fosc);\n}\n\n#page {\n  font-family: 'Space Grotesk', system-ui, sans-serif;\n  color: var(--color-accent);\n  line-height: 1.6; \n  font-size: 1rem;\n  background: var(--background);\n}\n\n.section-container {\n  max-width: var(--max-width, 1000px);\n  margin: 0 auto;\n  padding: 3rem var(--padding, 1rem); \n}\n\n.heading {\n  font-size: 3rem;\n  line-height: 1;\n  font-weight: 700;\n  margin: 0;\n}\n\n.button {\n  color: var(--crema);\n  padding: 0.5em 1.1em;\n  border-radius: 12px;\n}\n\n.button.primary.positive {\n    background-color: var(--color-accent);\n  }\n\n.button.primary.positive:hover {\n      background-color: var(--verd-clar);\n    }\n\n.button.secondary.positive, .button.tertiary.positive {\n    color: var(--color-accent);\n  }\n\n.button.secondary.positive:hover, .button.tertiary.positive:hover {\n      color: var(--verd-clar);\n    }\n\n.button.secondary.positive {\n    border: 1px solid var(--color-accent);\n  }\n\n.button.secondary.positive:hover {\n      border-color: var(--verd-clar);\n    }\n\n.button.primary.negative {\n    background-color: var(--crema) !important;\n    color: var(--color-accent);\n  }\n\n.button.primary.negative:hover {\n      background-color: var(--lila) !important;\n    }\n\n.button.secondary.negative:hover, .button.tertiary.negative:hover {\n      color: var(--lila);\n    }\n\n.button.secondary.negative {\n    border: 1px solid var(--crema);\n  }\n\n.button.secondary.negative:hover {\n      border-color: var(--lila);\n    }");
			this.h();
		},
		l(nodes) {
			const head_nodes = head_selector('svelte-1vga2bx', document.head);
			meta = claim_element(head_nodes, "META", { name: true, content: true });
			link0 = claim_element(head_nodes, "LINK", { rel: true, type: true, href: true });
			link1 = claim_element(head_nodes, "LINK", { rel: true, type: true, href: true });
			style = claim_element(head_nodes, "STYLE", {});
			var style_nodes = children(style);
			t = claim_text(style_nodes, "@import url(\"https://unpkg.com/@primo-app/primo@1.3.64/reset.css\");\n@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');\nhr {\n    border-top-width: 4px;\n    border-color: #194027;\n  border-style: dotted;\n}\n:root {\n  --verd-fosc: #194027;\n  --verd-clar:  #388762;\n  --taronja: #ff7f3f;\n  --lila-fosc: #dac9fa;\n  --lila: #e8e1fd;\n  --verd-fluor: #f3f7a5;\n  --crema: #fff5eb;\n  \n  --background: var(--crema);\n\n  --color-accent: var(--verd-fosc);\n}\n\n#page {\n  font-family: 'Space Grotesk', system-ui, sans-serif;\n  color: var(--color-accent);\n  line-height: 1.6; \n  font-size: 1rem;\n  background: var(--background);\n}\n\n.section-container {\n  max-width: var(--max-width, 1000px);\n  margin: 0 auto;\n  padding: 3rem var(--padding, 1rem); \n}\n\n.heading {\n  font-size: 3rem;\n  line-height: 1;\n  font-weight: 700;\n  margin: 0;\n}\n\n.button {\n  color: var(--crema);\n  padding: 0.5em 1.1em;\n  border-radius: 12px;\n}\n\n.button.primary.positive {\n    background-color: var(--color-accent);\n  }\n\n.button.primary.positive:hover {\n      background-color: var(--verd-clar);\n    }\n\n.button.secondary.positive, .button.tertiary.positive {\n    color: var(--color-accent);\n  }\n\n.button.secondary.positive:hover, .button.tertiary.positive:hover {\n      color: var(--verd-clar);\n    }\n\n.button.secondary.positive {\n    border: 1px solid var(--color-accent);\n  }\n\n.button.secondary.positive:hover {\n      border-color: var(--verd-clar);\n    }\n\n.button.primary.negative {\n    background-color: var(--crema) !important;\n    color: var(--color-accent);\n  }\n\n.button.primary.negative:hover {\n      background-color: var(--lila) !important;\n    }\n\n.button.secondary.negative:hover, .button.tertiary.negative:hover {\n      color: var(--lila);\n    }\n\n.button.secondary.negative {\n    border: 1px solid var(--crema);\n  }\n\n.button.secondary.negative:hover {\n      border-color: var(--lila);\n    }");
			style_nodes.forEach(detach);
			head_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(meta, "name", "viewport");
			attr(meta, "content", "width=device-width, initial-scale=1.0");
			attr(link0, "rel", "stylesheet");
			attr(link0, "type", "text/css");
			attr(link0, "href", "https://unpkg.com/@phosphor-icons/web@2.0.3/src/regular/style.css");
			attr(link1, "rel", "stylesheet");
			attr(link1, "type", "text/css");
			attr(link1, "href", "https://unpkg.com/@phosphor-icons/web@2.0.3/src/bold/style.css");
		},
		m(target, anchor) {
			append_hydration(document.head, meta);
			append_hydration(document.head, link0);
			append_hydration(document.head, link1);
			append_hydration(document.head, style);
			append_hydration(style, t);
		},
		p: noop,
		i: noop,
		o: noop,
		d(detaching) {
			detach(meta);
			detach(link0);
			detach(link1);
			detach(style);
		}
	};
}

class Component extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment, safe_not_equal, {});
	}
}

function fade(node, { delay = 0, duration = 400, easing = identity } = {}) {
    const o = +getComputedStyle(node).opacity;
    return {
        delay,
        duration,
        easing,
        css: t => `opacity: ${t * o}`
    };
}

const matchIconName = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const stringToIcon = (value, validate, allowSimpleName, provider = "") => {
  const colonSeparated = value.split(":");
  if (value.slice(0, 1) === "@") {
    if (colonSeparated.length < 2 || colonSeparated.length > 3) {
      return null;
    }
    provider = colonSeparated.shift().slice(1);
  }
  if (colonSeparated.length > 3 || !colonSeparated.length) {
    return null;
  }
  if (colonSeparated.length > 1) {
    const name2 = colonSeparated.pop();
    const prefix = colonSeparated.pop();
    const result = {
      provider: colonSeparated.length > 0 ? colonSeparated[0] : provider,
      prefix,
      name: name2
    };
    return validate && !validateIconName(result) ? null : result;
  }
  const name = colonSeparated[0];
  const dashSeparated = name.split("-");
  if (dashSeparated.length > 1) {
    const result = {
      provider,
      prefix: dashSeparated.shift(),
      name: dashSeparated.join("-")
    };
    return validate && !validateIconName(result) ? null : result;
  }
  if (allowSimpleName && provider === "") {
    const result = {
      provider,
      prefix: "",
      name
    };
    return validate && !validateIconName(result, allowSimpleName) ? null : result;
  }
  return null;
};
const validateIconName = (icon, allowSimpleName) => {
  if (!icon) {
    return false;
  }
  return !!((icon.provider === "" || icon.provider.match(matchIconName)) && (allowSimpleName && icon.prefix === "" || icon.prefix.match(matchIconName)) && icon.name.match(matchIconName));
};
const defaultIconDimensions = Object.freeze({
  left: 0,
  top: 0,
  width: 16,
  height: 16
});
const defaultIconTransformations = Object.freeze({
  rotate: 0,
  vFlip: false,
  hFlip: false
});
const defaultIconProps = Object.freeze({
  ...defaultIconDimensions,
  ...defaultIconTransformations
});
const defaultExtendedIconProps = Object.freeze({
  ...defaultIconProps,
  body: "",
  hidden: false
});
function mergeIconTransformations(obj1, obj2) {
  const result = {};
  if (!obj1.hFlip !== !obj2.hFlip) {
    result.hFlip = true;
  }
  if (!obj1.vFlip !== !obj2.vFlip) {
    result.vFlip = true;
  }
  const rotate = ((obj1.rotate || 0) + (obj2.rotate || 0)) % 4;
  if (rotate) {
    result.rotate = rotate;
  }
  return result;
}
function mergeIconData(parent, child) {
  const result = mergeIconTransformations(parent, child);
  for (const key in defaultExtendedIconProps) {
    if (key in defaultIconTransformations) {
      if (key in parent && !(key in result)) {
        result[key] = defaultIconTransformations[key];
      }
    } else if (key in child) {
      result[key] = child[key];
    } else if (key in parent) {
      result[key] = parent[key];
    }
  }
  return result;
}
function getIconsTree(data, names) {
  const icons = data.icons;
  const aliases = data.aliases || /* @__PURE__ */ Object.create(null);
  const resolved = /* @__PURE__ */ Object.create(null);
  function resolve(name) {
    if (icons[name]) {
      return resolved[name] = [];
    }
    if (!(name in resolved)) {
      resolved[name] = null;
      const parent = aliases[name] && aliases[name].parent;
      const value = parent && resolve(parent);
      if (value) {
        resolved[name] = [parent].concat(value);
      }
    }
    return resolved[name];
  }
  (names || Object.keys(icons).concat(Object.keys(aliases))).forEach(resolve);
  return resolved;
}
function internalGetIconData(data, name, tree) {
  const icons = data.icons;
  const aliases = data.aliases || /* @__PURE__ */ Object.create(null);
  let currentProps = {};
  function parse(name2) {
    currentProps = mergeIconData(icons[name2] || aliases[name2], currentProps);
  }
  parse(name);
  tree.forEach(parse);
  return mergeIconData(data, currentProps);
}
function parseIconSet(data, callback) {
  const names = [];
  if (typeof data !== "object" || typeof data.icons !== "object") {
    return names;
  }
  if (data.not_found instanceof Array) {
    data.not_found.forEach((name) => {
      callback(name, null);
      names.push(name);
    });
  }
  const tree = getIconsTree(data);
  for (const name in tree) {
    const item = tree[name];
    if (item) {
      callback(name, internalGetIconData(data, name, item));
      names.push(name);
    }
  }
  return names;
}
const optionalPropertyDefaults = {
  provider: "",
  aliases: {},
  not_found: {},
  ...defaultIconDimensions
};
function checkOptionalProps(item, defaults) {
  for (const prop in defaults) {
    if (prop in item && typeof item[prop] !== typeof defaults[prop]) {
      return false;
    }
  }
  return true;
}
function quicklyValidateIconSet(obj) {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const data = obj;
  if (typeof data.prefix !== "string" || !obj.icons || typeof obj.icons !== "object") {
    return null;
  }
  if (!checkOptionalProps(obj, optionalPropertyDefaults)) {
    return null;
  }
  const icons = data.icons;
  for (const name in icons) {
    const icon = icons[name];
    if (!name.match(matchIconName) || typeof icon.body !== "string" || !checkOptionalProps(icon, defaultExtendedIconProps)) {
      return null;
    }
  }
  const aliases = data.aliases || /* @__PURE__ */ Object.create(null);
  for (const name in aliases) {
    const icon = aliases[name];
    const parent = icon.parent;
    if (!name.match(matchIconName) || typeof parent !== "string" || !icons[parent] && !aliases[parent] || !checkOptionalProps(icon, defaultExtendedIconProps)) {
      return null;
    }
  }
  return data;
}
const dataStorage = /* @__PURE__ */ Object.create(null);
function newStorage(provider, prefix) {
  return {
    provider,
    prefix,
    icons: /* @__PURE__ */ Object.create(null),
    missing: /* @__PURE__ */ new Set()
  };
}
function getStorage(provider, prefix) {
  const providerStorage = dataStorage[provider] || (dataStorage[provider] = /* @__PURE__ */ Object.create(null));
  return providerStorage[prefix] || (providerStorage[prefix] = newStorage(provider, prefix));
}
function addIconSet(storage2, data) {
  if (!quicklyValidateIconSet(data)) {
    return [];
  }
  return parseIconSet(data, (name, icon) => {
    if (icon) {
      storage2.icons[name] = icon;
    } else {
      storage2.missing.add(name);
    }
  });
}
function addIconToStorage(storage2, name, icon) {
  try {
    if (typeof icon.body === "string") {
      storage2.icons[name] = {...icon};
      return true;
    }
  } catch (err) {
  }
  return false;
}
let simpleNames = false;
function allowSimpleNames(allow) {
  if (typeof allow === "boolean") {
    simpleNames = allow;
  }
  return simpleNames;
}
function getIconData(name) {
  const icon = typeof name === "string" ? stringToIcon(name, true, simpleNames) : name;
  if (icon) {
    const storage2 = getStorage(icon.provider, icon.prefix);
    const iconName = icon.name;
    return storage2.icons[iconName] || (storage2.missing.has(iconName) ? null : void 0);
  }
}
function addIcon(name, data) {
  const icon = stringToIcon(name, true, simpleNames);
  if (!icon) {
    return false;
  }
  const storage2 = getStorage(icon.provider, icon.prefix);
  return addIconToStorage(storage2, icon.name, data);
}
function addCollection(data, provider) {
  if (typeof data !== "object") {
    return false;
  }
  if (typeof provider !== "string") {
    provider = data.provider || "";
  }
  if (simpleNames && !provider && !data.prefix) {
    let added = false;
    if (quicklyValidateIconSet(data)) {
      data.prefix = "";
      parseIconSet(data, (name, icon) => {
        if (icon && addIcon(name, icon)) {
          added = true;
        }
      });
    }
    return added;
  }
  const prefix = data.prefix;
  if (!validateIconName({
    provider,
    prefix,
    name: "a"
  })) {
    return false;
  }
  const storage2 = getStorage(provider, prefix);
  return !!addIconSet(storage2, data);
}
const defaultIconSizeCustomisations = Object.freeze({
  width: null,
  height: null
});
const defaultIconCustomisations = Object.freeze({
  ...defaultIconSizeCustomisations,
  ...defaultIconTransformations
});
const unitsSplit = /(-?[0-9.]*[0-9]+[0-9.]*)/g;
const unitsTest = /^-?[0-9.]*[0-9]+[0-9.]*$/g;
function calculateSize(size, ratio, precision) {
  if (ratio === 1) {
    return size;
  }
  precision = precision || 100;
  if (typeof size === "number") {
    return Math.ceil(size * ratio * precision) / precision;
  }
  if (typeof size !== "string") {
    return size;
  }
  const oldParts = size.split(unitsSplit);
  if (oldParts === null || !oldParts.length) {
    return size;
  }
  const newParts = [];
  let code = oldParts.shift();
  let isNumber = unitsTest.test(code);
  while (true) {
    if (isNumber) {
      const num = parseFloat(code);
      if (isNaN(num)) {
        newParts.push(code);
      } else {
        newParts.push(Math.ceil(num * ratio * precision) / precision);
      }
    } else {
      newParts.push(code);
    }
    code = oldParts.shift();
    if (code === void 0) {
      return newParts.join("");
    }
    isNumber = !isNumber;
  }
}
const isUnsetKeyword = (value) => value === "unset" || value === "undefined" || value === "none";
function iconToSVG(icon, customisations) {
  const fullIcon = {
    ...defaultIconProps,
    ...icon
  };
  const fullCustomisations = {
    ...defaultIconCustomisations,
    ...customisations
  };
  const box = {
    left: fullIcon.left,
    top: fullIcon.top,
    width: fullIcon.width,
    height: fullIcon.height
  };
  let body = fullIcon.body;
  [fullIcon, fullCustomisations].forEach((props) => {
    const transformations = [];
    const hFlip = props.hFlip;
    const vFlip = props.vFlip;
    let rotation = props.rotate;
    if (hFlip) {
      if (vFlip) {
        rotation += 2;
      } else {
        transformations.push("translate(" + (box.width + box.left).toString() + " " + (0 - box.top).toString() + ")");
        transformations.push("scale(-1 1)");
        box.top = box.left = 0;
      }
    } else if (vFlip) {
      transformations.push("translate(" + (0 - box.left).toString() + " " + (box.height + box.top).toString() + ")");
      transformations.push("scale(1 -1)");
      box.top = box.left = 0;
    }
    let tempValue;
    if (rotation < 0) {
      rotation -= Math.floor(rotation / 4) * 4;
    }
    rotation = rotation % 4;
    switch (rotation) {
      case 1:
        tempValue = box.height / 2 + box.top;
        transformations.unshift("rotate(90 " + tempValue.toString() + " " + tempValue.toString() + ")");
        break;
      case 2:
        transformations.unshift("rotate(180 " + (box.width / 2 + box.left).toString() + " " + (box.height / 2 + box.top).toString() + ")");
        break;
      case 3:
        tempValue = box.width / 2 + box.left;
        transformations.unshift("rotate(-90 " + tempValue.toString() + " " + tempValue.toString() + ")");
        break;
    }
    if (rotation % 2 === 1) {
      if (box.left !== box.top) {
        tempValue = box.left;
        box.left = box.top;
        box.top = tempValue;
      }
      if (box.width !== box.height) {
        tempValue = box.width;
        box.width = box.height;
        box.height = tempValue;
      }
    }
    if (transformations.length) {
      body = '<g transform="' + transformations.join(" ") + '">' + body + "</g>";
    }
  });
  const customisationsWidth = fullCustomisations.width;
  const customisationsHeight = fullCustomisations.height;
  const boxWidth = box.width;
  const boxHeight = box.height;
  let width;
  let height;
  if (customisationsWidth === null) {
    height = customisationsHeight === null ? "1em" : customisationsHeight === "auto" ? boxHeight : customisationsHeight;
    width = calculateSize(height, boxWidth / boxHeight);
  } else {
    width = customisationsWidth === "auto" ? boxWidth : customisationsWidth;
    height = customisationsHeight === null ? calculateSize(width, boxHeight / boxWidth) : customisationsHeight === "auto" ? boxHeight : customisationsHeight;
  }
  const attributes = {};
  const setAttr = (prop, value) => {
    if (!isUnsetKeyword(value)) {
      attributes[prop] = value.toString();
    }
  };
  setAttr("width", width);
  setAttr("height", height);
  attributes.viewBox = box.left.toString() + " " + box.top.toString() + " " + boxWidth.toString() + " " + boxHeight.toString();
  return {
    attributes,
    body
  };
}
const regex = /\sid="(\S+)"/g;
const randomPrefix = "IconifyId" + Date.now().toString(16) + (Math.random() * 16777216 | 0).toString(16);
let counter = 0;
function replaceIDs(body, prefix = randomPrefix) {
  const ids = [];
  let match;
  while (match = regex.exec(body)) {
    ids.push(match[1]);
  }
  if (!ids.length) {
    return body;
  }
  const suffix = "suffix" + (Math.random() * 16777216 | Date.now()).toString(16);
  ids.forEach((id) => {
    const newID = typeof prefix === "function" ? prefix(id) : prefix + (counter++).toString();
    const escapedID = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    body = body.replace(new RegExp('([#;"])(' + escapedID + ')([")]|\\.[a-z])', "g"), "$1" + newID + suffix + "$3");
  });
  body = body.replace(new RegExp(suffix, "g"), "");
  return body;
}
const storage = /* @__PURE__ */ Object.create(null);
function setAPIModule(provider, item) {
  storage[provider] = item;
}
function getAPIModule(provider) {
  return storage[provider] || storage[""];
}
function createAPIConfig(source) {
  let resources;
  if (typeof source.resources === "string") {
    resources = [source.resources];
  } else {
    resources = source.resources;
    if (!(resources instanceof Array) || !resources.length) {
      return null;
    }
  }
  const result = {
    resources,
    path: source.path || "/",
    maxURL: source.maxURL || 500,
    rotate: source.rotate || 750,
    timeout: source.timeout || 5e3,
    random: source.random === true,
    index: source.index || 0,
    dataAfterTimeout: source.dataAfterTimeout !== false
  };
  return result;
}
const configStorage = /* @__PURE__ */ Object.create(null);
const fallBackAPISources = [
  "https://api.simplesvg.com",
  "https://api.unisvg.com"
];
const fallBackAPI = [];
while (fallBackAPISources.length > 0) {
  if (fallBackAPISources.length === 1) {
    fallBackAPI.push(fallBackAPISources.shift());
  } else {
    if (Math.random() > 0.5) {
      fallBackAPI.push(fallBackAPISources.shift());
    } else {
      fallBackAPI.push(fallBackAPISources.pop());
    }
  }
}
configStorage[""] = createAPIConfig({
  resources: ["https://api.iconify.design"].concat(fallBackAPI)
});
function addAPIProvider(provider, customConfig) {
  const config = createAPIConfig(customConfig);
  if (config === null) {
    return false;
  }
  configStorage[provider] = config;
  return true;
}
function getAPIConfig(provider) {
  return configStorage[provider];
}
const detectFetch = () => {
  let callback;
  try {
    callback = fetch;
    if (typeof callback === "function") {
      return callback;
    }
  } catch (err) {
  }
};
let fetchModule = detectFetch();
function calculateMaxLength(provider, prefix) {
  const config = getAPIConfig(provider);
  if (!config) {
    return 0;
  }
  let result;
  if (!config.maxURL) {
    result = 0;
  } else {
    let maxHostLength = 0;
    config.resources.forEach((item) => {
      const host = item;
      maxHostLength = Math.max(maxHostLength, host.length);
    });
    const url = prefix + ".json?icons=";
    result = config.maxURL - maxHostLength - config.path.length - url.length;
  }
  return result;
}
function shouldAbort(status) {
  return status === 404;
}
const prepare = (provider, prefix, icons) => {
  const results = [];
  const maxLength = calculateMaxLength(provider, prefix);
  const type = "icons";
  let item = {
    type,
    provider,
    prefix,
    icons: []
  };
  let length = 0;
  icons.forEach((name, index) => {
    length += name.length + 1;
    if (length >= maxLength && index > 0) {
      results.push(item);
      item = {
        type,
        provider,
        prefix,
        icons: []
      };
      length = name.length;
    }
    item.icons.push(name);
  });
  results.push(item);
  return results;
};
function getPath(provider) {
  if (typeof provider === "string") {
    const config = getAPIConfig(provider);
    if (config) {
      return config.path;
    }
  }
  return "/";
}
const send = (host, params, callback) => {
  if (!fetchModule) {
    callback("abort", 424);
    return;
  }
  let path = getPath(params.provider);
  switch (params.type) {
    case "icons": {
      const prefix = params.prefix;
      const icons = params.icons;
      const iconsList = icons.join(",");
      const urlParams = new URLSearchParams({
        icons: iconsList
      });
      path += prefix + ".json?" + urlParams.toString();
      break;
    }
    case "custom": {
      const uri = params.uri;
      path += uri.slice(0, 1) === "/" ? uri.slice(1) : uri;
      break;
    }
    default:
      callback("abort", 400);
      return;
  }
  let defaultError = 503;
  fetchModule(host + path).then((response) => {
    const status = response.status;
    if (status !== 200) {
      setTimeout(() => {
        callback(shouldAbort(status) ? "abort" : "next", status);
      });
      return;
    }
    defaultError = 501;
    return response.json();
  }).then((data) => {
    if (typeof data !== "object" || data === null) {
      setTimeout(() => {
        if (data === 404) {
          callback("abort", data);
        } else {
          callback("next", defaultError);
        }
      });
      return;
    }
    setTimeout(() => {
      callback("success", data);
    });
  }).catch(() => {
    callback("next", defaultError);
  });
};
const fetchAPIModule = {
  prepare,
  send
};
function sortIcons(icons) {
  const result = {
    loaded: [],
    missing: [],
    pending: []
  };
  const storage2 = /* @__PURE__ */ Object.create(null);
  icons.sort((a, b) => {
    if (a.provider !== b.provider) {
      return a.provider.localeCompare(b.provider);
    }
    if (a.prefix !== b.prefix) {
      return a.prefix.localeCompare(b.prefix);
    }
    return a.name.localeCompare(b.name);
  });
  let lastIcon = {
    provider: "",
    prefix: "",
    name: ""
  };
  icons.forEach((icon) => {
    if (lastIcon.name === icon.name && lastIcon.prefix === icon.prefix && lastIcon.provider === icon.provider) {
      return;
    }
    lastIcon = icon;
    const provider = icon.provider;
    const prefix = icon.prefix;
    const name = icon.name;
    const providerStorage = storage2[provider] || (storage2[provider] = /* @__PURE__ */ Object.create(null));
    const localStorage = providerStorage[prefix] || (providerStorage[prefix] = getStorage(provider, prefix));
    let list;
    if (name in localStorage.icons) {
      list = result.loaded;
    } else if (prefix === "" || localStorage.missing.has(name)) {
      list = result.missing;
    } else {
      list = result.pending;
    }
    const item = {
      provider,
      prefix,
      name
    };
    list.push(item);
  });
  return result;
}
function removeCallback(storages, id) {
  storages.forEach((storage2) => {
    const items = storage2.loaderCallbacks;
    if (items) {
      storage2.loaderCallbacks = items.filter((row) => row.id !== id);
    }
  });
}
function updateCallbacks(storage2) {
  if (!storage2.pendingCallbacksFlag) {
    storage2.pendingCallbacksFlag = true;
    setTimeout(() => {
      storage2.pendingCallbacksFlag = false;
      const items = storage2.loaderCallbacks ? storage2.loaderCallbacks.slice(0) : [];
      if (!items.length) {
        return;
      }
      let hasPending = false;
      const provider = storage2.provider;
      const prefix = storage2.prefix;
      items.forEach((item) => {
        const icons = item.icons;
        const oldLength = icons.pending.length;
        icons.pending = icons.pending.filter((icon) => {
          if (icon.prefix !== prefix) {
            return true;
          }
          const name = icon.name;
          if (storage2.icons[name]) {
            icons.loaded.push({
              provider,
              prefix,
              name
            });
          } else if (storage2.missing.has(name)) {
            icons.missing.push({
              provider,
              prefix,
              name
            });
          } else {
            hasPending = true;
            return true;
          }
          return false;
        });
        if (icons.pending.length !== oldLength) {
          if (!hasPending) {
            removeCallback([storage2], item.id);
          }
          item.callback(icons.loaded.slice(0), icons.missing.slice(0), icons.pending.slice(0), item.abort);
        }
      });
    });
  }
}
let idCounter = 0;
function storeCallback(callback, icons, pendingSources) {
  const id = idCounter++;
  const abort = removeCallback.bind(null, pendingSources, id);
  if (!icons.pending.length) {
    return abort;
  }
  const item = {
    id,
    icons,
    callback,
    abort
  };
  pendingSources.forEach((storage2) => {
    (storage2.loaderCallbacks || (storage2.loaderCallbacks = [])).push(item);
  });
  return abort;
}
function listToIcons(list, validate = true, simpleNames2 = false) {
  const result = [];
  list.forEach((item) => {
    const icon = typeof item === "string" ? stringToIcon(item, validate, simpleNames2) : item;
    if (icon) {
      result.push(icon);
    }
  });
  return result;
}
var defaultConfig = {
  resources: [],
  index: 0,
  timeout: 2e3,
  rotate: 750,
  random: false,
  dataAfterTimeout: false
};
function sendQuery(config, payload, query, done) {
  const resourcesCount = config.resources.length;
  const startIndex = config.random ? Math.floor(Math.random() * resourcesCount) : config.index;
  let resources;
  if (config.random) {
    let list = config.resources.slice(0);
    resources = [];
    while (list.length > 1) {
      const nextIndex = Math.floor(Math.random() * list.length);
      resources.push(list[nextIndex]);
      list = list.slice(0, nextIndex).concat(list.slice(nextIndex + 1));
    }
    resources = resources.concat(list);
  } else {
    resources = config.resources.slice(startIndex).concat(config.resources.slice(0, startIndex));
  }
  const startTime = Date.now();
  let status = "pending";
  let queriesSent = 0;
  let lastError;
  let timer = null;
  let queue = [];
  let doneCallbacks = [];
  if (typeof done === "function") {
    doneCallbacks.push(done);
  }
  function resetTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function abort() {
    if (status === "pending") {
      status = "aborted";
    }
    resetTimer();
    queue.forEach((item) => {
      if (item.status === "pending") {
        item.status = "aborted";
      }
    });
    queue = [];
  }
  function subscribe(callback, overwrite) {
    if (overwrite) {
      doneCallbacks = [];
    }
    if (typeof callback === "function") {
      doneCallbacks.push(callback);
    }
  }
  function getQueryStatus() {
    return {
      startTime,
      payload,
      status,
      queriesSent,
      queriesPending: queue.length,
      subscribe,
      abort
    };
  }
  function failQuery() {
    status = "failed";
    doneCallbacks.forEach((callback) => {
      callback(void 0, lastError);
    });
  }
  function clearQueue() {
    queue.forEach((item) => {
      if (item.status === "pending") {
        item.status = "aborted";
      }
    });
    queue = [];
  }
  function moduleResponse(item, response, data) {
    const isError = response !== "success";
    queue = queue.filter((queued) => queued !== item);
    switch (status) {
      case "pending":
        break;
      case "failed":
        if (isError || !config.dataAfterTimeout) {
          return;
        }
        break;
      default:
        return;
    }
    if (response === "abort") {
      lastError = data;
      failQuery();
      return;
    }
    if (isError) {
      lastError = data;
      if (!queue.length) {
        if (!resources.length) {
          failQuery();
        } else {
          execNext();
        }
      }
      return;
    }
    resetTimer();
    clearQueue();
    if (!config.random) {
      const index = config.resources.indexOf(item.resource);
      if (index !== -1 && index !== config.index) {
        config.index = index;
      }
    }
    status = "completed";
    doneCallbacks.forEach((callback) => {
      callback(data);
    });
  }
  function execNext() {
    if (status !== "pending") {
      return;
    }
    resetTimer();
    const resource = resources.shift();
    if (resource === void 0) {
      if (queue.length) {
        timer = setTimeout(() => {
          resetTimer();
          if (status === "pending") {
            clearQueue();
            failQuery();
          }
        }, config.timeout);
        return;
      }
      failQuery();
      return;
    }
    const item = {
      status: "pending",
      resource,
      callback: (status2, data) => {
        moduleResponse(item, status2, data);
      }
    };
    queue.push(item);
    queriesSent++;
    timer = setTimeout(execNext, config.rotate);
    query(resource, payload, item.callback);
  }
  setTimeout(execNext);
  return getQueryStatus;
}
function initRedundancy(cfg) {
  const config = {
    ...defaultConfig,
    ...cfg
  };
  let queries = [];
  function cleanup() {
    queries = queries.filter((item) => item().status === "pending");
  }
  function query(payload, queryCallback, doneCallback) {
    const query2 = sendQuery(config, payload, queryCallback, (data, error) => {
      cleanup();
      if (doneCallback) {
        doneCallback(data, error);
      }
    });
    queries.push(query2);
    return query2;
  }
  function find(callback) {
    return queries.find((value) => {
      return callback(value);
    }) || null;
  }
  const instance = {
    query,
    find,
    setIndex: (index) => {
      config.index = index;
    },
    getIndex: () => config.index,
    cleanup
  };
  return instance;
}
function emptyCallback$1() {
}
const redundancyCache = /* @__PURE__ */ Object.create(null);
function getRedundancyCache(provider) {
  if (!redundancyCache[provider]) {
    const config = getAPIConfig(provider);
    if (!config) {
      return;
    }
    const redundancy = initRedundancy(config);
    const cachedReundancy = {
      config,
      redundancy
    };
    redundancyCache[provider] = cachedReundancy;
  }
  return redundancyCache[provider];
}
function sendAPIQuery(target, query, callback) {
  let redundancy;
  let send2;
  if (typeof target === "string") {
    const api = getAPIModule(target);
    if (!api) {
      callback(void 0, 424);
      return emptyCallback$1;
    }
    send2 = api.send;
    const cached = getRedundancyCache(target);
    if (cached) {
      redundancy = cached.redundancy;
    }
  } else {
    const config = createAPIConfig(target);
    if (config) {
      redundancy = initRedundancy(config);
      const moduleKey = target.resources ? target.resources[0] : "";
      const api = getAPIModule(moduleKey);
      if (api) {
        send2 = api.send;
      }
    }
  }
  if (!redundancy || !send2) {
    callback(void 0, 424);
    return emptyCallback$1;
  }
  return redundancy.query(query, send2, callback)().abort;
}
const browserCacheVersion = "iconify2";
const browserCachePrefix = "iconify";
const browserCacheCountKey = browserCachePrefix + "-count";
const browserCacheVersionKey = browserCachePrefix + "-version";
const browserStorageHour = 36e5;
const browserStorageCacheExpiration = 168;
function getStoredItem(func, key) {
  try {
    return func.getItem(key);
  } catch (err) {
  }
}
function setStoredItem(func, key, value) {
  try {
    func.setItem(key, value);
    return true;
  } catch (err) {
  }
}
function removeStoredItem(func, key) {
  try {
    func.removeItem(key);
  } catch (err) {
  }
}
function setBrowserStorageItemsCount(storage2, value) {
  return setStoredItem(storage2, browserCacheCountKey, value.toString());
}
function getBrowserStorageItemsCount(storage2) {
  return parseInt(getStoredItem(storage2, browserCacheCountKey)) || 0;
}
const browserStorageConfig = {
  local: true,
  session: true
};
const browserStorageEmptyItems = {
  local: /* @__PURE__ */ new Set(),
  session: /* @__PURE__ */ new Set()
};
let browserStorageStatus = false;
function setBrowserStorageStatus(status) {
  browserStorageStatus = status;
}
let _window = typeof window === "undefined" ? {} : window;
function getBrowserStorage(key) {
  const attr = key + "Storage";
  try {
    if (_window && _window[attr] && typeof _window[attr].length === "number") {
      return _window[attr];
    }
  } catch (err) {
  }
  browserStorageConfig[key] = false;
}
function iterateBrowserStorage(key, callback) {
  const func = getBrowserStorage(key);
  if (!func) {
    return;
  }
  const version = getStoredItem(func, browserCacheVersionKey);
  if (version !== browserCacheVersion) {
    if (version) {
      const total2 = getBrowserStorageItemsCount(func);
      for (let i = 0; i < total2; i++) {
        removeStoredItem(func, browserCachePrefix + i.toString());
      }
    }
    setStoredItem(func, browserCacheVersionKey, browserCacheVersion);
    setBrowserStorageItemsCount(func, 0);
    return;
  }
  const minTime = Math.floor(Date.now() / browserStorageHour) - browserStorageCacheExpiration;
  const parseItem = (index) => {
    const name = browserCachePrefix + index.toString();
    const item = getStoredItem(func, name);
    if (typeof item !== "string") {
      return;
    }
    try {
      const data = JSON.parse(item);
      if (typeof data === "object" && typeof data.cached === "number" && data.cached > minTime && typeof data.provider === "string" && typeof data.data === "object" && typeof data.data.prefix === "string" && callback(data, index)) {
        return true;
      }
    } catch (err) {
    }
    removeStoredItem(func, name);
  };
  let total = getBrowserStorageItemsCount(func);
  for (let i = total - 1; i >= 0; i--) {
    if (!parseItem(i)) {
      if (i === total - 1) {
        total--;
        setBrowserStorageItemsCount(func, total);
      } else {
        browserStorageEmptyItems[key].add(i);
      }
    }
  }
}
function initBrowserStorage() {
  if (browserStorageStatus) {
    return;
  }
  setBrowserStorageStatus(true);
  for (const key in browserStorageConfig) {
    iterateBrowserStorage(key, (item) => {
      const iconSet = item.data;
      const provider = item.provider;
      const prefix = iconSet.prefix;
      const storage2 = getStorage(provider, prefix);
      if (!addIconSet(storage2, iconSet).length) {
        return false;
      }
      const lastModified = iconSet.lastModified || -1;
      storage2.lastModifiedCached = storage2.lastModifiedCached ? Math.min(storage2.lastModifiedCached, lastModified) : lastModified;
      return true;
    });
  }
}
function updateLastModified(storage2, lastModified) {
  const lastValue = storage2.lastModifiedCached;
  if (lastValue && lastValue >= lastModified) {
    return lastValue === lastModified;
  }
  storage2.lastModifiedCached = lastModified;
  if (lastValue) {
    for (const key in browserStorageConfig) {
      iterateBrowserStorage(key, (item) => {
        const iconSet = item.data;
        return item.provider !== storage2.provider || iconSet.prefix !== storage2.prefix || iconSet.lastModified === lastModified;
      });
    }
  }
  return true;
}
function storeInBrowserStorage(storage2, data) {
  if (!browserStorageStatus) {
    initBrowserStorage();
  }
  function store(key) {
    let func;
    if (!browserStorageConfig[key] || !(func = getBrowserStorage(key))) {
      return;
    }
    const set = browserStorageEmptyItems[key];
    let index;
    if (set.size) {
      set.delete(index = Array.from(set).shift());
    } else {
      index = getBrowserStorageItemsCount(func);
      if (!setBrowserStorageItemsCount(func, index + 1)) {
        return;
      }
    }
    const item = {
      cached: Math.floor(Date.now() / browserStorageHour),
      provider: storage2.provider,
      data
    };
    return setStoredItem(func, browserCachePrefix + index.toString(), JSON.stringify(item));
  }
  if (data.lastModified && !updateLastModified(storage2, data.lastModified)) {
    return;
  }
  if (!Object.keys(data.icons).length) {
    return;
  }
  if (data.not_found) {
    data = Object.assign({}, data);
    delete data.not_found;
  }
  if (!store("local")) {
    store("session");
  }
}
function emptyCallback() {
}
function loadedNewIcons(storage2) {
  if (!storage2.iconsLoaderFlag) {
    storage2.iconsLoaderFlag = true;
    setTimeout(() => {
      storage2.iconsLoaderFlag = false;
      updateCallbacks(storage2);
    });
  }
}
function loadNewIcons(storage2, icons) {
  if (!storage2.iconsToLoad) {
    storage2.iconsToLoad = icons;
  } else {
    storage2.iconsToLoad = storage2.iconsToLoad.concat(icons).sort();
  }
  if (!storage2.iconsQueueFlag) {
    storage2.iconsQueueFlag = true;
    setTimeout(() => {
      storage2.iconsQueueFlag = false;
      const {provider, prefix} = storage2;
      const icons2 = storage2.iconsToLoad;
      delete storage2.iconsToLoad;
      let api;
      if (!icons2 || !(api = getAPIModule(provider))) {
        return;
      }
      const params = api.prepare(provider, prefix, icons2);
      params.forEach((item) => {
        sendAPIQuery(provider, item, (data) => {
          if (typeof data !== "object") {
            item.icons.forEach((name) => {
              storage2.missing.add(name);
            });
          } else {
            try {
              const parsed = addIconSet(storage2, data);
              if (!parsed.length) {
                return;
              }
              const pending = storage2.pendingIcons;
              if (pending) {
                parsed.forEach((name) => {
                  pending.delete(name);
                });
              }
              storeInBrowserStorage(storage2, data);
            } catch (err) {
              console.error(err);
            }
          }
          loadedNewIcons(storage2);
        });
      });
    });
  }
}
const loadIcons = (icons, callback) => {
  const cleanedIcons = listToIcons(icons, true, allowSimpleNames());
  const sortedIcons = sortIcons(cleanedIcons);
  if (!sortedIcons.pending.length) {
    let callCallback = true;
    if (callback) {
      setTimeout(() => {
        if (callCallback) {
          callback(sortedIcons.loaded, sortedIcons.missing, sortedIcons.pending, emptyCallback);
        }
      });
    }
    return () => {
      callCallback = false;
    };
  }
  const newIcons = /* @__PURE__ */ Object.create(null);
  const sources = [];
  let lastProvider, lastPrefix;
  sortedIcons.pending.forEach((icon) => {
    const {provider, prefix} = icon;
    if (prefix === lastPrefix && provider === lastProvider) {
      return;
    }
    lastProvider = provider;
    lastPrefix = prefix;
    sources.push(getStorage(provider, prefix));
    const providerNewIcons = newIcons[provider] || (newIcons[provider] = /* @__PURE__ */ Object.create(null));
    if (!providerNewIcons[prefix]) {
      providerNewIcons[prefix] = [];
    }
  });
  sortedIcons.pending.forEach((icon) => {
    const {provider, prefix, name} = icon;
    const storage2 = getStorage(provider, prefix);
    const pendingQueue = storage2.pendingIcons || (storage2.pendingIcons = /* @__PURE__ */ new Set());
    if (!pendingQueue.has(name)) {
      pendingQueue.add(name);
      newIcons[provider][prefix].push(name);
    }
  });
  sources.forEach((storage2) => {
    const {provider, prefix} = storage2;
    if (newIcons[provider][prefix].length) {
      loadNewIcons(storage2, newIcons[provider][prefix]);
    }
  });
  return callback ? storeCallback(callback, sortedIcons, sources) : emptyCallback;
};
function mergeCustomisations(defaults, item) {
  const result = {
    ...defaults
  };
  for (const key in item) {
    const value = item[key];
    const valueType = typeof value;
    if (key in defaultIconSizeCustomisations) {
      if (value === null || value && (valueType === "string" || valueType === "number")) {
        result[key] = value;
      }
    } else if (valueType === typeof result[key]) {
      result[key] = key === "rotate" ? value % 4 : value;
    }
  }
  return result;
}
const separator = /[\s,]+/;
function flipFromString(custom, flip) {
  flip.split(separator).forEach((str) => {
    const value = str.trim();
    switch (value) {
      case "horizontal":
        custom.hFlip = true;
        break;
      case "vertical":
        custom.vFlip = true;
        break;
    }
  });
}
function rotateFromString(value, defaultValue = 0) {
  const units = value.replace(/^-?[0-9.]*/, "");
  function cleanup(value2) {
    while (value2 < 0) {
      value2 += 4;
    }
    return value2 % 4;
  }
  if (units === "") {
    const num = parseInt(value);
    return isNaN(num) ? 0 : cleanup(num);
  } else if (units !== value) {
    let split = 0;
    switch (units) {
      case "%":
        split = 25;
        break;
      case "deg":
        split = 90;
    }
    if (split) {
      let num = parseFloat(value.slice(0, value.length - units.length));
      if (isNaN(num)) {
        return 0;
      }
      num = num / split;
      return num % 1 === 0 ? cleanup(num) : 0;
    }
  }
  return defaultValue;
}
function iconToHTML(body, attributes) {
  let renderAttribsHTML = body.indexOf("xlink:") === -1 ? "" : ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  for (const attr in attributes) {
    renderAttribsHTML += " " + attr + '="' + attributes[attr] + '"';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg"' + renderAttribsHTML + ">" + body + "</svg>";
}
function encodeSVGforURL(svg) {
  return svg.replace(/"/g, "'").replace(/%/g, "%25").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\s+/g, " ");
}
function svgToData(svg) {
  return "data:image/svg+xml," + encodeSVGforURL(svg);
}
function svgToURL(svg) {
  return 'url("' + svgToData(svg) + '")';
}
const defaultExtendedIconCustomisations = {
  ...defaultIconCustomisations,
  inline: false
};
const svgDefaults = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  "aria-hidden": true,
  role: "img"
};
const commonProps = {
  display: "inline-block"
};
const monotoneProps = {
  "background-color": "currentColor"
};
const coloredProps = {
  "background-color": "transparent"
};
const propsToAdd = {
  image: "var(--svg)",
  repeat: "no-repeat",
  size: "100% 100%"
};
const propsToAddTo = {
  "-webkit-mask": monotoneProps,
  mask: monotoneProps,
  background: coloredProps
};
for (const prefix in propsToAddTo) {
  const list = propsToAddTo[prefix];
  for (const prop in propsToAdd) {
    list[prefix + "-" + prop] = propsToAdd[prop];
  }
}
function fixSize(value) {
  return value + (value.match(/^[-0-9.]+$/) ? "px" : "");
}
function render(icon, props) {
  const customisations = mergeCustomisations(defaultExtendedIconCustomisations, props);
  const mode = props.mode || "svg";
  const componentProps = mode === "svg" ? {...svgDefaults} : {};
  if (icon.body.indexOf("xlink:") === -1) {
    delete componentProps["xmlns:xlink"];
  }
  let style = typeof props.style === "string" ? props.style : "";
  for (let key in props) {
    const value = props[key];
    if (value === void 0) {
      continue;
    }
    switch (key) {
      case "icon":
      case "style":
      case "onLoad":
      case "mode":
        break;
      case "inline":
      case "hFlip":
      case "vFlip":
        customisations[key] = value === true || value === "true" || value === 1;
        break;
      case "flip":
        if (typeof value === "string") {
          flipFromString(customisations, value);
        }
        break;
      case "color":
        style = style + (style.length > 0 && style.trim().slice(-1) !== ";" ? ";" : "") + "color: " + value + "; ";
        break;
      case "rotate":
        if (typeof value === "string") {
          customisations[key] = rotateFromString(value);
        } else if (typeof value === "number") {
          customisations[key] = value;
        }
        break;
      case "ariaHidden":
      case "aria-hidden":
        if (value !== true && value !== "true") {
          delete componentProps["aria-hidden"];
        }
        break;
      default:
        if (key.slice(0, 3) === "on:") {
          break;
        }
        if (defaultExtendedIconCustomisations[key] === void 0) {
          componentProps[key] = value;
        }
    }
  }
  const item = iconToSVG(icon, customisations);
  const renderAttribs = item.attributes;
  if (customisations.inline) {
    style = "vertical-align: -0.125em; " + style;
  }
  if (mode === "svg") {
    Object.assign(componentProps, renderAttribs);
    if (style !== "") {
      componentProps.style = style;
    }
    let localCounter = 0;
    let id = props.id;
    if (typeof id === "string") {
      id = id.replace(/-/g, "_");
    }
    return {
      svg: true,
      attributes: componentProps,
      body: replaceIDs(item.body, id ? () => id + "ID" + localCounter++ : "iconifySvelte")
    };
  }
  const {body, width, height} = icon;
  const useMask = mode === "mask" || (mode === "bg" ? false : body.indexOf("currentColor") !== -1);
  const html = iconToHTML(body, {
    ...renderAttribs,
    width: width + "",
    height: height + ""
  });
  const url = svgToURL(html);
  const styles = {
    "--svg": url
  };
  const size = (prop) => {
    const value = renderAttribs[prop];
    if (value) {
      styles[prop] = fixSize(value);
    }
  };
  size("width");
  size("height");
  Object.assign(styles, commonProps, useMask ? monotoneProps : coloredProps);
  let customStyle = "";
  for (const key in styles) {
    customStyle += key + ": " + styles[key] + ";";
  }
  componentProps.style = customStyle + style;
  return {
    svg: false,
    attributes: componentProps
  };
}
allowSimpleNames(true);
setAPIModule("", fetchAPIModule);
if (typeof document !== "undefined" && typeof window !== "undefined") {
  initBrowserStorage();
  const _window2 = window;
  if (_window2.IconifyPreload !== void 0) {
    const preload = _window2.IconifyPreload;
    const err = "Invalid IconifyPreload syntax.";
    if (typeof preload === "object" && preload !== null) {
      (preload instanceof Array ? preload : [preload]).forEach((item) => {
        try {
          if (typeof item !== "object" || item === null || item instanceof Array || typeof item.icons !== "object" || typeof item.prefix !== "string" || !addCollection(item)) {
            console.error(err);
          }
        } catch (e) {
          console.error(err);
        }
      });
    }
  }
  if (_window2.IconifyProviders !== void 0) {
    const providers = _window2.IconifyProviders;
    if (typeof providers === "object" && providers !== null) {
      for (let key in providers) {
        const err = "IconifyProviders[" + key + "] is invalid.";
        try {
          const value = providers[key];
          if (typeof value !== "object" || !value || value.resources === void 0) {
            continue;
          }
          if (!addAPIProvider(key, value)) {
            console.error(err);
          }
        } catch (e) {
          console.error(err);
        }
      }
    }
  }
}
function checkIconState(icon, state, mounted, callback, onload) {
  function abortLoading() {
    if (state.loading) {
      state.loading.abort();
      state.loading = null;
    }
  }
  if (typeof icon === "object" && icon !== null && typeof icon.body === "string") {
    state.name = "";
    abortLoading();
    return {data: {...defaultIconProps, ...icon}};
  }
  let iconName;
  if (typeof icon !== "string" || (iconName = stringToIcon(icon, false, true)) === null) {
    abortLoading();
    return null;
  }
  const data = getIconData(iconName);
  if (!data) {
    if (mounted && (!state.loading || state.loading.name !== icon)) {
      abortLoading();
      state.name = "";
      state.loading = {
        name: icon,
        abort: loadIcons([iconName], callback)
      };
    }
    return null;
  }
  abortLoading();
  if (state.name !== icon) {
    state.name = icon;
    if (onload && !state.destroyed) {
      onload(icon);
    }
  }
  const classes = ["iconify"];
  if (iconName.prefix !== "") {
    classes.push("iconify--" + iconName.prefix);
  }
  if (iconName.provider !== "") {
    classes.push("iconify--" + iconName.provider);
  }
  return {data, classes};
}
function generateIcon(icon, props) {
  return icon ? render({
    ...defaultIconProps,
    ...icon
  }, props) : null;
}
var checkIconState_1 = checkIconState;
var generateIcon_1 = generateIcon;

/* generated by Svelte v3.58.0 */

function create_if_block(ctx) {
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (/*data*/ ctx[0].svg) return create_if_block_1;
		return create_else_block;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

// (113:1) {:else}
function create_else_block(ctx) {
	let span;
	let span_levels = [/*data*/ ctx[0].attributes];
	let span_data = {};

	for (let i = 0; i < span_levels.length; i += 1) {
		span_data = assign(span_data, span_levels[i]);
	}

	return {
		c() {
			span = element("span");
			this.h();
		},
		l(nodes) {
			span = claim_element(nodes, "SPAN", {});
			children(span).forEach(detach);
			this.h();
		},
		h() {
			set_attributes(span, span_data);
		},
		m(target, anchor) {
			insert_hydration(target, span, anchor);
		},
		p(ctx, dirty) {
			set_attributes(span, span_data = get_spread_update(span_levels, [dirty & /*data*/ 1 && /*data*/ ctx[0].attributes]));
		},
		d(detaching) {
			if (detaching) detach(span);
		}
	};
}

// (109:1) {#if data.svg}
function create_if_block_1(ctx) {
	let svg;
	let raw_value = /*data*/ ctx[0].body + "";
	let svg_levels = [/*data*/ ctx[0].attributes];
	let svg_data = {};

	for (let i = 0; i < svg_levels.length; i += 1) {
		svg_data = assign(svg_data, svg_levels[i]);
	}

	return {
		c() {
			svg = svg_element("svg");
			this.h();
		},
		l(nodes) {
			svg = claim_svg_element(nodes, "svg", {});
			var svg_nodes = children(svg);
			svg_nodes.forEach(detach);
			this.h();
		},
		h() {
			set_svg_attributes(svg, svg_data);
		},
		m(target, anchor) {
			insert_hydration(target, svg, anchor);
			svg.innerHTML = raw_value;
		},
		p(ctx, dirty) {
			if (dirty & /*data*/ 1 && raw_value !== (raw_value = /*data*/ ctx[0].body + "")) svg.innerHTML = raw_value;			set_svg_attributes(svg, svg_data = get_spread_update(svg_levels, [dirty & /*data*/ 1 && /*data*/ ctx[0].attributes]));
		},
		d(detaching) {
			if (detaching) detach(svg);
		}
	};
}

function create_fragment$1(ctx) {
	let if_block_anchor;
	let if_block = /*data*/ ctx[0] && create_if_block(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if (if_block) if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, [dirty]) {
			if (/*data*/ ctx[0]) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (if_block) if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	const state = {
		// Last icon name
		name: '',
		// Loading status
		loading: null,
		// Destroyed status
		destroyed: false
	};

	// Mounted status
	let mounted = false;

	// Callback counter
	let counter = 0;

	// Generated data
	let data;

	const onLoad = icon => {
		// Legacy onLoad property
		if (typeof $$props.onLoad === 'function') {
			$$props.onLoad(icon);
		}

		// on:load event
		const dispatch = createEventDispatcher();

		dispatch('load', { icon });
	};

	// Increase counter when loaded to force re-calculation of data
	function loaded() {
		$$invalidate(3, counter++, counter);
	}

	// Force re-render
	onMount(() => {
		$$invalidate(2, mounted = true);
	});

	// Abort loading when component is destroyed
	onDestroy(() => {
		$$invalidate(1, state.destroyed = true, state);

		if (state.loading) {
			state.loading.abort();
			$$invalidate(1, state.loading = null, state);
		}
	});

	$$self.$$set = $$new_props => {
		$$invalidate(6, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
	};

	$$self.$$.update = () => {
		 {
			const iconData = checkIconState_1($$props.icon, state, mounted, loaded, onLoad);
			$$invalidate(0, data = iconData ? generateIcon_1(iconData.data, $$props) : null);

			if (data && iconData.classes) {
				// Add classes
				$$invalidate(
					0,
					data.attributes['class'] = (typeof $$props['class'] === 'string'
					? $$props['class'] + ' '
					: '') + iconData.classes.join(' '),
					data
				);
			}
		}
	};

	$$props = exclude_internal_props($$props);
	return [data, state, mounted, counter];
}

class Component$1 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment$1, safe_not_equal, {});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i].link;
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i].link;
	return child_ctx;
}

// (140:33) 
function create_if_block_4(ctx) {
	let img;
	let img_src_value;
	let img_alt_value;

	return {
		c() {
			img = element("img");
			this.h();
		},
		l(nodes) {
			img = claim_element(nodes, "IMG", { src: true, alt: true });
			this.h();
		},
		h() {
			if (!src_url_equal(img.src, img_src_value = /*logo*/ ctx[2].image.url)) attr(img, "src", img_src_value);
			attr(img, "alt", img_alt_value = /*logo*/ ctx[2].image.alt);
		},
		m(target, anchor) {
			insert_hydration(target, img, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 4 && !src_url_equal(img.src, img_src_value = /*logo*/ ctx[2].image.url)) {
				attr(img, "src", img_src_value);
			}

			if (dirty & /*logo*/ 4 && img_alt_value !== (img_alt_value = /*logo*/ ctx[2].image.alt)) {
				attr(img, "alt", img_alt_value);
			}
		},
		d(detaching) {
			if (detaching) detach(img);
		}
	};
}

// (138:8) {#if logo.title}
function create_if_block_3(ctx) {
	let t_value = /*logo*/ ctx[2].title + "";
	let t;

	return {
		c() {
			t = text(t_value);
		},
		l(nodes) {
			t = claim_text(nodes, t_value);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 4 && t_value !== (t_value = /*logo*/ ctx[2].title + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

// (145:8) {#each site_nav as { link }}
function create_each_block_1(ctx) {
	let a;
	let t_value = /*link*/ ctx[8].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link svelte-1hv5gtq");
			attr(a, "href", a_href_value = /*link*/ ctx[8].url);
			toggle_class(a, "active", /*link*/ ctx[8].url === window.location.pathname);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 8 && t_value !== (t_value = /*link*/ ctx[8].label + "")) set_data(t, t_value);

			if (dirty & /*site_nav*/ 8 && a_href_value !== (a_href_value = /*link*/ ctx[8].url)) {
				attr(a, "href", a_href_value);
			}

			if (dirty & /*site_nav, window*/ 8) {
				toggle_class(a, "active", /*link*/ ctx[8].url === window.location.pathname);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

// (154:33) 
function create_if_block_2(ctx) {
	let img;
	let img_src_value;
	let img_alt_value;

	return {
		c() {
			img = element("img");
			this.h();
		},
		l(nodes) {
			img = claim_element(nodes, "IMG", { src: true, alt: true });
			this.h();
		},
		h() {
			if (!src_url_equal(img.src, img_src_value = /*logo*/ ctx[2].image.url)) attr(img, "src", img_src_value);
			attr(img, "alt", img_alt_value = /*logo*/ ctx[2].image.alt);
		},
		m(target, anchor) {
			insert_hydration(target, img, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 4 && !src_url_equal(img.src, img_src_value = /*logo*/ ctx[2].image.url)) {
				attr(img, "src", img_src_value);
			}

			if (dirty & /*logo*/ 4 && img_alt_value !== (img_alt_value = /*logo*/ ctx[2].image.alt)) {
				attr(img, "alt", img_alt_value);
			}
		},
		d(detaching) {
			if (detaching) detach(img);
		}
	};
}

// (152:8) {#if logo.title}
function create_if_block_1$1(ctx) {
	let t_value = /*logo*/ ctx[2].title + "";
	let t;

	return {
		c() {
			t = text(t_value);
		},
		l(nodes) {
			t = claim_text(nodes, t_value);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*logo*/ 4 && t_value !== (t_value = /*logo*/ ctx[2].title + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(t);
		}
	};
}

// (164:6) {#if mobileNavOpen}
function create_if_block$1(ctx) {
	let nav;
	let t;
	let button;
	let icon;
	let nav_transition;
	let current;
	let mounted;
	let dispose;
	let each_value = /*site_nav*/ ctx[3];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	icon = new Component$1({ props: { height: "25", icon: "bi:x-lg" } });

	return {
		c() {
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			button = element("button");
			create_component(icon.$$.fragment);
			this.h();
		},
		l(nodes) {
			nav = claim_element(nodes, "NAV", { id: true, class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			t = claim_space(nav_nodes);

			button = claim_element(nav_nodes, "BUTTON", {
				id: true,
				"aria-label": true,
				class: true
			});

			var button_nodes = children(button);
			claim_component(icon.$$.fragment, button_nodes);
			button_nodes.forEach(detach);
			nav_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(button, "id", "close");
			attr(button, "aria-label", "Close Navigation");
			attr(button, "class", "svelte-1hv5gtq");
			attr(nav, "id", "popup");
			attr(nav, "class", "svelte-1hv5gtq");
		},
		m(target, anchor) {
			insert_hydration(target, nav, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(nav, t);
			append_hydration(nav, button);
			mount_component(icon, button, null);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler_1*/ ctx[6]);
				mounted = true;
			}
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 8) {
				each_value = /*site_nav*/ ctx[3];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, t);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);

			add_render_callback(() => {
				if (!current) return;
				if (!nav_transition) nav_transition = create_bidirectional_transition(nav, fade, { duration: 200 }, true);
				nav_transition.run(1);
			});

			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			if (!nav_transition) nav_transition = create_bidirectional_transition(nav, fade, { duration: 200 }, false);
			nav_transition.run(0);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(nav);
			destroy_each(each_blocks, detaching);
			destroy_component(icon);
			if (detaching && nav_transition) nav_transition.end();
			mounted = false;
			dispose();
		}
	};
}

// (166:10) {#each site_nav as { link }}
function create_each_block(ctx) {
	let a;
	let t_value = /*link*/ ctx[8].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[8].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*site_nav*/ 8 && t_value !== (t_value = /*link*/ ctx[8].label + "")) set_data(t, t_value);

			if (dirty & /*site_nav*/ 8 && a_href_value !== (a_href_value = /*link*/ ctx[8].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

function create_fragment$2(ctx) {
	let div5;
	let header;
	let div0;
	let t0;
	let div3;
	let div1;
	let a0;
	let t1;
	let nav;
	let t2;
	let div2;
	let a1;
	let t3;
	let button;
	let icon;
	let t4;
	let t5;
	let div4;
	let h1;
	let t6;
	let header_aria_label_value;
	let current;
	let mounted;
	let dispose;

	function select_block_type(ctx, dirty) {
		if (/*logo*/ ctx[2].title) return create_if_block_3;
		if (/*logo*/ ctx[2].image.url) return create_if_block_4;
	}

	let current_block_type = select_block_type(ctx);
	let if_block0 = current_block_type && current_block_type(ctx);
	let each_value_1 = /*site_nav*/ ctx[3];
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	function select_block_type_1(ctx, dirty) {
		if (/*logo*/ ctx[2].title) return create_if_block_1$1;
		if (/*logo*/ ctx[2].image.url) return create_if_block_2;
	}

	let current_block_type_1 = select_block_type_1(ctx);
	let if_block1 = current_block_type_1 && current_block_type_1(ctx);

	icon = new Component$1({
			props: { height: "30", icon: "eva:menu-outline" }
		});

	let if_block2 = /*mobileNavOpen*/ ctx[4] && create_if_block$1(ctx);

	return {
		c() {
			div5 = element("div");
			header = element("header");
			div0 = element("div");
			t0 = space();
			div3 = element("div");
			div1 = element("div");
			a0 = element("a");
			if (if_block0) if_block0.c();
			t1 = space();
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t2 = space();
			div2 = element("div");
			a1 = element("a");
			if (if_block1) if_block1.c();
			t3 = space();
			button = element("button");
			create_component(icon.$$.fragment);
			t4 = space();
			if (if_block2) if_block2.c();
			t5 = space();
			div4 = element("div");
			h1 = element("h1");
			t6 = text(/*headline*/ ctx[1]);
			this.h();
		},
		l(nodes) {
			div5 = claim_element(nodes, "DIV", { class: true, id: true });
			var div5_nodes = children(div5);

			header = claim_element(div5_nodes, "HEADER", {
				style: true,
				role: true,
				"aria-label": true,
				class: true
			});

			var header_nodes = children(header);
			div0 = claim_element(header_nodes, "DIV", { class: true });
			children(div0).forEach(detach);
			t0 = claim_space(header_nodes);
			div3 = claim_element(header_nodes, "DIV", { class: true });
			var div3_nodes = children(div3);
			div1 = claim_element(div3_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			a0 = claim_element(div1_nodes, "A", { href: true, class: true });
			var a0_nodes = children(a0);
			if (if_block0) if_block0.l(a0_nodes);
			a0_nodes.forEach(detach);
			t1 = claim_space(div1_nodes);
			nav = claim_element(div1_nodes, "NAV", { class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			nav_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			t2 = claim_space(div3_nodes);
			div2 = claim_element(div3_nodes, "DIV", { class: true });
			var div2_nodes = children(div2);
			a1 = claim_element(div2_nodes, "A", { href: true, class: true });
			var a1_nodes = children(a1);
			if (if_block1) if_block1.l(a1_nodes);
			a1_nodes.forEach(detach);
			t3 = claim_space(div2_nodes);
			button = claim_element(div2_nodes, "BUTTON", { id: true, "aria-label": true });
			var button_nodes = children(button);
			claim_component(icon.$$.fragment, button_nodes);
			button_nodes.forEach(detach);
			t4 = claim_space(div2_nodes);
			if (if_block2) if_block2.l(div2_nodes);
			div2_nodes.forEach(detach);
			div3_nodes.forEach(detach);
			t5 = claim_space(header_nodes);
			div4 = claim_element(header_nodes, "DIV", { class: true });
			var div4_nodes = children(div4);
			h1 = claim_element(div4_nodes, "H1", { class: true });
			var h1_nodes = children(h1);
			t6 = claim_text(h1_nodes, /*headline*/ ctx[1]);
			h1_nodes.forEach(detach);
			div4_nodes.forEach(detach);
			header_nodes.forEach(detach);
			div5_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div0, "class", "header-background svelte-1hv5gtq");
			attr(a0, "href", "/");
			attr(a0, "class", "logo svelte-1hv5gtq");
			attr(nav, "class", "svelte-1hv5gtq");
			attr(div1, "class", "desktop-nav svelte-1hv5gtq");
			attr(a1, "href", "/");
			attr(a1, "class", "logo svelte-1hv5gtq");
			attr(button, "id", "open");
			attr(button, "aria-label", "Open mobile navigation");
			attr(div2, "class", "mobile-nav svelte-1hv5gtq");
			attr(div3, "class", "section-container svelte-1hv5gtq");
			attr(h1, "class", "headline svelte-1hv5gtq");
			attr(div4, "class", "section-container svelte-1hv5gtq");
			set_style(header, "background-image", "url('" + /*background*/ ctx[0].url + "')");
			attr(header, "role", "img");
			attr(header, "aria-label", header_aria_label_value = /*background*/ ctx[0].alt);
			attr(header, "class", "svelte-1hv5gtq");
			attr(div5, "class", "section");
			attr(div5, "id", "section-3452f627");
		},
		m(target, anchor) {
			insert_hydration(target, div5, anchor);
			append_hydration(div5, header);
			append_hydration(header, div0);
			append_hydration(header, t0);
			append_hydration(header, div3);
			append_hydration(div3, div1);
			append_hydration(div1, a0);
			if (if_block0) if_block0.m(a0, null);
			append_hydration(div1, t1);
			append_hydration(div1, nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(div3, t2);
			append_hydration(div3, div2);
			append_hydration(div2, a1);
			if (if_block1) if_block1.m(a1, null);
			append_hydration(div2, t3);
			append_hydration(div2, button);
			mount_component(icon, button, null);
			append_hydration(div2, t4);
			if (if_block2) if_block2.m(div2, null);
			append_hydration(header, t5);
			append_hydration(header, div4);
			append_hydration(div4, h1);
			append_hydration(h1, t6);
			current = true;

			if (!mounted) {
				dispose = listen(button, "click", /*click_handler*/ ctx[5]);
				mounted = true;
			}
		},
		p(ctx, [dirty]) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block0) {
				if_block0.p(ctx, dirty);
			} else {
				if (if_block0) if_block0.d(1);
				if_block0 = current_block_type && current_block_type(ctx);

				if (if_block0) {
					if_block0.c();
					if_block0.m(a0, null);
				}
			}

			if (dirty & /*site_nav, window*/ 8) {
				each_value_1 = /*site_nav*/ ctx[3];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_1(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_1.length;
			}

			if (current_block_type_1 === (current_block_type_1 = select_block_type_1(ctx)) && if_block1) {
				if_block1.p(ctx, dirty);
			} else {
				if (if_block1) if_block1.d(1);
				if_block1 = current_block_type_1 && current_block_type_1(ctx);

				if (if_block1) {
					if_block1.c();
					if_block1.m(a1, null);
				}
			}

			if (/*mobileNavOpen*/ ctx[4]) {
				if (if_block2) {
					if_block2.p(ctx, dirty);

					if (dirty & /*mobileNavOpen*/ 16) {
						transition_in(if_block2, 1);
					}
				} else {
					if_block2 = create_if_block$1(ctx);
					if_block2.c();
					transition_in(if_block2, 1);
					if_block2.m(div2, null);
				}
			} else if (if_block2) {
				group_outros();

				transition_out(if_block2, 1, 1, () => {
					if_block2 = null;
				});

				check_outros();
			}

			if (!current || dirty & /*headline*/ 2) set_data(t6, /*headline*/ ctx[1]);

			if (!current || dirty & /*background*/ 1) {
				set_style(header, "background-image", "url('" + /*background*/ ctx[0].url + "')");
			}

			if (!current || dirty & /*background*/ 1 && header_aria_label_value !== (header_aria_label_value = /*background*/ ctx[0].alt)) {
				attr(header, "aria-label", header_aria_label_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			transition_in(if_block2);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			transition_out(if_block2);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div5);

			if (if_block0) {
				if_block0.d();
			}

			destroy_each(each_blocks, detaching);

			if (if_block1) {
				if_block1.d();
			}

			destroy_component(icon);
			if (if_block2) if_block2.d();
			mounted = false;
			dispose();
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let { background } = $$props;
	let { headline } = $$props;
	let { logo } = $$props;
	let { site_nav } = $$props;
	let mobileNavOpen = false;

	const click_handler = () => $$invalidate(4, mobileNavOpen = true);
	const click_handler_1 = () => $$invalidate(4, mobileNavOpen = false);

	$$self.$$set = $$props => {
		if ('background' in $$props) $$invalidate(0, background = $$props.background);
		if ('headline' in $$props) $$invalidate(1, headline = $$props.headline);
		if ('logo' in $$props) $$invalidate(2, logo = $$props.logo);
		if ('site_nav' in $$props) $$invalidate(3, site_nav = $$props.site_nav);
	};

	return [
		background,
		headline,
		logo,
		site_nav,
		mobileNavOpen,
		click_handler,
		click_handler_1
	];
}

class Component$2 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$1, create_fragment$2, safe_not_equal, {
			background: 0,
			headline: 1,
			logo: 2,
			site_nav: 3
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[3] = list[i];
	child_ctx[5] = i;
	return child_ctx;
}

// (55:2) {#if buttons.length > 0}
function create_if_block$2(ctx) {
	let div;
	let each_value = /*buttons*/ ctx[2];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
	}

	return {
		c() {
			div = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div_nodes);
			}

			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div, "class", "buttons svelte-1tp7z49");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div, null);
				}
			}
		},
		p(ctx, dirty) {
			if (dirty & /*buttons*/ 4) {
				each_value = /*buttons*/ ctx[2];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$1(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block$1(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_each(each_blocks, detaching);
		}
	};
}

// (57:6) {#each buttons as button, i}
function create_each_block$1(ctx) {
	let a;
	let t_value = /*button*/ ctx[3].link.label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "button svelte-1tp7z49");
			attr(a, "href", a_href_value = /*button*/ ctx[3].link.url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*buttons*/ 4 && t_value !== (t_value = /*button*/ ctx[3].link.label + "")) set_data(t, t_value);

			if (dirty & /*buttons*/ 4 && a_href_value !== (a_href_value = /*button*/ ctx[3].link.url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

function create_fragment$3(ctx) {
	let div;
	let header;
	let h1;
	let t0;
	let t1;
	let span;
	let t2;
	let t3;
	let if_block = /*buttons*/ ctx[2].length > 0 && create_if_block$2(ctx);

	return {
		c() {
			div = element("div");
			header = element("header");
			h1 = element("h1");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			span = element("span");
			t2 = text(/*subheading*/ ctx[1]);
			t3 = space();
			if (if_block) if_block.c();
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true, id: true });
			var div_nodes = children(div);
			header = claim_element(div_nodes, "HEADER", { class: true });
			var header_nodes = children(header);
			h1 = claim_element(header_nodes, "H1", { class: true });
			var h1_nodes = children(h1);
			t0 = claim_text(h1_nodes, /*heading*/ ctx[0]);
			h1_nodes.forEach(detach);
			t1 = claim_space(header_nodes);
			span = claim_element(header_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			t2 = claim_text(span_nodes, /*subheading*/ ctx[1]);
			span_nodes.forEach(detach);
			t3 = claim_space(header_nodes);
			if (if_block) if_block.l(header_nodes);
			header_nodes.forEach(detach);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h1, "class", "heading svelte-1tp7z49");
			attr(span, "class", "subheading svelte-1tp7z49");
			attr(header, "class", "section-container svelte-1tp7z49");
			attr(div, "class", "section");
			attr(div, "id", "section-50961dfb");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			append_hydration(div, header);
			append_hydration(header, h1);
			append_hydration(h1, t0);
			append_hydration(header, t1);
			append_hydration(header, span);
			append_hydration(span, t2);
			append_hydration(header, t3);
			if (if_block) if_block.m(header, null);
		},
		p(ctx, [dirty]) {
			if (dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);
			if (dirty & /*subheading*/ 2) set_data(t2, /*subheading*/ ctx[1]);

			if (/*buttons*/ ctx[2].length > 0) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block$2(ctx);
					if_block.c();
					if_block.m(header, null);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div);
			if (if_block) if_block.d();
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { heading } = $$props;
	let { subheading } = $$props;
	let { buttons } = $$props;

	$$self.$$set = $$props => {
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('subheading' in $$props) $$invalidate(1, subheading = $$props.subheading);
		if ('buttons' in $$props) $$invalidate(2, buttons = $$props.buttons);
	};

	return [heading, subheading, buttons];
}

class Component$3 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$2, create_fragment$3, safe_not_equal, { heading: 0, subheading: 1, buttons: 2 });
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[2] = list[i];
	return child_ctx;
}

// (50:4) {#each cards as card}
function create_each_block$2(ctx) {
	let li;
	let h3;
	let span0;
	let icon;
	let t0;
	let span1;
	let t1_value = /*card*/ ctx[2].title + "";
	let t1;
	let t2;
	let div;
	let raw_value = /*card*/ ctx[2].description.html + "";
	let t3;
	let current;

	icon = new Component$1({
			props: {
				icon: /*card*/ ctx[2].icon,
				width: "22",
				height: "22",
				style: "color: var(--taronja)"
			}
		});

	return {
		c() {
			li = element("li");
			h3 = element("h3");
			span0 = element("span");
			create_component(icon.$$.fragment);
			t0 = space();
			span1 = element("span");
			t1 = text(t1_value);
			t2 = space();
			div = element("div");
			t3 = space();
			this.h();
		},
		l(nodes) {
			li = claim_element(nodes, "LI", { class: true });
			var li_nodes = children(li);
			h3 = claim_element(li_nodes, "H3", { class: true });
			var h3_nodes = children(h3);
			span0 = claim_element(h3_nodes, "SPAN", {});
			var span0_nodes = children(span0);
			claim_component(icon.$$.fragment, span0_nodes);
			span0_nodes.forEach(detach);
			t0 = claim_space(h3_nodes);
			span1 = claim_element(h3_nodes, "SPAN", { class: true });
			var span1_nodes = children(span1);
			t1 = claim_text(span1_nodes, t1_value);
			span1_nodes.forEach(detach);
			h3_nodes.forEach(detach);
			t2 = claim_space(li_nodes);
			div = claim_element(li_nodes, "DIV", { class: true });
			var div_nodes = children(div);
			div_nodes.forEach(detach);
			t3 = claim_space(li_nodes);
			li_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span1, "class", "label svelte-gc3typ");
			attr(h3, "class", "title svelte-gc3typ");
			attr(div, "class", "description");
			attr(li, "class", "svelte-gc3typ");
		},
		m(target, anchor) {
			insert_hydration(target, li, anchor);
			append_hydration(li, h3);
			append_hydration(h3, span0);
			mount_component(icon, span0, null);
			append_hydration(h3, t0);
			append_hydration(h3, span1);
			append_hydration(span1, t1);
			append_hydration(li, t2);
			append_hydration(li, div);
			div.innerHTML = raw_value;
			append_hydration(li, t3);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*cards*/ 2) icon_changes.icon = /*card*/ ctx[2].icon;
			icon.$set(icon_changes);
			if ((!current || dirty & /*cards*/ 2) && t1_value !== (t1_value = /*card*/ ctx[2].title + "")) set_data(t1, t1_value);
			if ((!current || dirty & /*cards*/ 2) && raw_value !== (raw_value = /*card*/ ctx[2].description.html + "")) div.innerHTML = raw_value;		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(icon);
		}
	};
}

function create_fragment$4(ctx) {
	let div;
	let section;
	let h2;
	let t0;
	let t1;
	let ul;
	let current;
	let each_value = /*cards*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$2(get_each_context$2(ctx, each_value, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div = element("div");
			section = element("section");
			h2 = element("h2");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true, id: true });
			var div_nodes = children(div);
			section = claim_element(div_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			h2 = claim_element(section_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			t0 = claim_text(h2_nodes, /*heading*/ ctx[0]);
			h2_nodes.forEach(detach);
			t1 = claim_space(section_nodes);
			ul = claim_element(section_nodes, "UL", { class: true });
			var ul_nodes = children(ul);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(ul_nodes);
			}

			ul_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-gc3typ");
			attr(ul, "class", "svelte-gc3typ");
			attr(section, "class", "section-container svelte-gc3typ");
			attr(div, "class", "section");
			attr(div, "id", "section-402b314c");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			append_hydration(div, section);
			append_hydration(section, h2);
			append_hydration(h2, t0);
			append_hydration(section, t1);
			append_hydration(section, ul);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(ul, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);

			if (dirty & /*cards*/ 2) {
				each_value = /*cards*/ ctx[1];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$2(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$2(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(ul, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$3($$self, $$props, $$invalidate) {
	let { heading } = $$props;
	let { cards } = $$props;

	$$self.$$set = $$props => {
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('cards' in $$props) $$invalidate(1, cards = $$props.cards);
	};

	return [heading, cards];
}

class Component$4 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$3, create_fragment$4, safe_not_equal, { heading: 0, cards: 1 });
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$3(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[4] = list[i];
	return child_ctx;
}

function get_each_context_1$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[7] = list[i].icon;
	child_ctx[8] = list[i].label;
	return child_ctx;
}

// (100:4) {#each icon_list as { icon, label }}
function create_each_block_1$1(ctx) {
	let li;
	let span0;
	let icon;
	let t0;
	let span1;
	let t1_value = /*label*/ ctx[8] + "";
	let t1;
	let t2;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[7] } });

	return {
		c() {
			li = element("li");
			span0 = element("span");
			create_component(icon.$$.fragment);
			t0 = space();
			span1 = element("span");
			t1 = text(t1_value);
			t2 = space();
			this.h();
		},
		l(nodes) {
			li = claim_element(nodes, "LI", { class: true });
			var li_nodes = children(li);
			span0 = claim_element(li_nodes, "SPAN", { class: true });
			var span0_nodes = children(span0);
			claim_component(icon.$$.fragment, span0_nodes);
			span0_nodes.forEach(detach);
			t0 = claim_space(li_nodes);
			span1 = claim_element(li_nodes, "SPAN", {});
			var span1_nodes = children(span1);
			t1 = claim_text(span1_nodes, t1_value);
			span1_nodes.forEach(detach);
			t2 = claim_space(li_nodes);
			li_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span0, "class", "icon svelte-evuxz0");
			attr(li, "class", "svelte-evuxz0");
		},
		m(target, anchor) {
			insert_hydration(target, li, anchor);
			append_hydration(li, span0);
			mount_component(icon, span0, null);
			append_hydration(li, t0);
			append_hydration(li, span1);
			append_hydration(span1, t1);
			append_hydration(li, t2);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*icon_list*/ 4) icon_changes.icon = /*icon*/ ctx[7];
			icon.$set(icon_changes);
			if ((!current || dirty & /*icon_list*/ 4) && t1_value !== (t1_value = /*label*/ ctx[8] + "")) set_data(t1, t1_value);
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(icon);
		}
	};
}

// (110:4) {#each cards as card}
function create_each_block$3(ctx) {
	let li;
	let div0;
	let icon;
	let t0;
	let div2;
	let h3;
	let t1_value = /*card*/ ctx[4].title + "";
	let t1;
	let t2;
	let div1;
	let raw_value = /*card*/ ctx[4].content.html + "";
	let t3;
	let a;
	let span;
	let t4_value = /*card*/ ctx[4].link.label + "";
	let t4;
	let a_href_value;
	let t5;
	let current;
	icon = new Component$1({ props: { icon: /*card*/ ctx[4].icon } });

	return {
		c() {
			li = element("li");
			div0 = element("div");
			create_component(icon.$$.fragment);
			t0 = space();
			div2 = element("div");
			h3 = element("h3");
			t1 = text(t1_value);
			t2 = space();
			div1 = element("div");
			t3 = space();
			a = element("a");
			span = element("span");
			t4 = text(t4_value);
			t5 = space();
			this.h();
		},
		l(nodes) {
			li = claim_element(nodes, "LI", { class: true });
			var li_nodes = children(li);
			div0 = claim_element(li_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			claim_component(icon.$$.fragment, div0_nodes);
			div0_nodes.forEach(detach);
			t0 = claim_space(li_nodes);
			div2 = claim_element(li_nodes, "DIV", { class: true });
			var div2_nodes = children(div2);
			h3 = claim_element(div2_nodes, "H3", { class: true });
			var h3_nodes = children(h3);
			t1 = claim_text(h3_nodes, t1_value);
			h3_nodes.forEach(detach);
			t2 = claim_space(div2_nodes);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			div1_nodes.forEach(detach);
			t3 = claim_space(div2_nodes);
			a = claim_element(div2_nodes, "A", { href: true, class: true });
			var a_nodes = children(a);
			span = claim_element(a_nodes, "SPAN", {});
			var span_nodes = children(span);
			t4 = claim_text(span_nodes, t4_value);
			span_nodes.forEach(detach);
			a_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			t5 = claim_space(li_nodes);
			li_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div0, "class", "icon svelte-evuxz0");
			attr(h3, "class", "title svelte-evuxz0");
			attr(div1, "class", "content svelte-evuxz0");
			attr(a, "href", a_href_value = /*card*/ ctx[4].link.url);
			attr(a, "class", "link svelte-evuxz0");
			attr(div2, "class", "body svelte-evuxz0");
			attr(li, "class", "svelte-evuxz0");
		},
		m(target, anchor) {
			insert_hydration(target, li, anchor);
			append_hydration(li, div0);
			mount_component(icon, div0, null);
			append_hydration(li, t0);
			append_hydration(li, div2);
			append_hydration(div2, h3);
			append_hydration(h3, t1);
			append_hydration(div2, t2);
			append_hydration(div2, div1);
			div1.innerHTML = raw_value;
			append_hydration(div2, t3);
			append_hydration(div2, a);
			append_hydration(a, span);
			append_hydration(span, t4);
			append_hydration(li, t5);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*cards*/ 8) icon_changes.icon = /*card*/ ctx[4].icon;
			icon.$set(icon_changes);
			if ((!current || dirty & /*cards*/ 8) && t1_value !== (t1_value = /*card*/ ctx[4].title + "")) set_data(t1, t1_value);
			if ((!current || dirty & /*cards*/ 8) && raw_value !== (raw_value = /*card*/ ctx[4].content.html + "")) div1.innerHTML = raw_value;			if ((!current || dirty & /*cards*/ 8) && t4_value !== (t4_value = /*card*/ ctx[4].link.label + "")) set_data(t4, t4_value);

			if (!current || dirty & /*cards*/ 8 && a_href_value !== (a_href_value = /*card*/ ctx[4].link.url)) {
				attr(a, "href", a_href_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(icon);
		}
	};
}

function create_fragment$5(ctx) {
	let div2;
	let div1;
	let section;
	let header;
	let h2;
	let t0;
	let div0;
	let t1;
	let t2;
	let ul0;
	let t3;
	let ul1;
	let current;
	let each_value_1 = /*icon_list*/ ctx[2];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
	}

	const out = i => transition_out(each_blocks_1[i], 1, 1, () => {
		each_blocks_1[i] = null;
	});

	let each_value = /*cards*/ ctx[3];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$3(get_each_context$3(ctx, each_value, i));
	}

	const out_1 = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div2 = element("div");
			div1 = element("div");
			section = element("section");
			header = element("header");
			h2 = element("h2");
			t0 = space();
			div0 = element("div");
			t1 = text(/*subhead*/ ctx[1]);
			t2 = space();
			ul0 = element("ul");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t3 = space();
			ul1 = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div2 = claim_element(nodes, "DIV", { class: true, id: true });
			var div2_nodes = children(div2);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			section = claim_element(div1_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			header = claim_element(section_nodes, "HEADER", { class: true });
			var header_nodes = children(header);
			h2 = claim_element(header_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			h2_nodes.forEach(detach);
			t0 = claim_space(header_nodes);
			div0 = claim_element(header_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			t1 = claim_text(div0_nodes, /*subhead*/ ctx[1]);
			div0_nodes.forEach(detach);
			header_nodes.forEach(detach);
			t2 = claim_space(section_nodes);
			ul0 = claim_element(section_nodes, "UL", { class: true });
			var ul0_nodes = children(ul0);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].l(ul0_nodes);
			}

			ul0_nodes.forEach(detach);
			t3 = claim_space(section_nodes);
			ul1 = claim_element(section_nodes, "UL", { class: true });
			var ul1_nodes = children(ul1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(ul1_nodes);
			}

			ul1_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-evuxz0");
			attr(div0, "class", "subheading");
			attr(header, "class", "heading-group svelte-evuxz0");
			attr(ul0, "class", "icon-list svelte-evuxz0");
			attr(ul1, "class", "cards svelte-evuxz0");
			attr(section, "class", "section-container svelte-evuxz0");
			attr(div1, "class", "background svelte-evuxz0");
			attr(div2, "class", "section");
			attr(div2, "id", "section-08a63993");
		},
		m(target, anchor) {
			insert_hydration(target, div2, anchor);
			append_hydration(div2, div1);
			append_hydration(div1, section);
			append_hydration(section, header);
			append_hydration(header, h2);
			h2.innerHTML = /*heading*/ ctx[0];
			append_hydration(header, t0);
			append_hydration(header, div0);
			append_hydration(div0, t1);
			append_hydration(section, t2);
			append_hydration(section, ul0);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(ul0, null);
				}
			}

			append_hydration(section, t3);
			append_hydration(section, ul1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(ul1, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) h2.innerHTML = /*heading*/ ctx[0];			if (!current || dirty & /*subhead*/ 2) set_data(t1, /*subhead*/ ctx[1]);

			if (dirty & /*icon_list*/ 4) {
				each_value_1 = /*icon_list*/ ctx[2];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
						transition_in(each_blocks_1[i], 1);
					} else {
						each_blocks_1[i] = create_each_block_1$1(child_ctx);
						each_blocks_1[i].c();
						transition_in(each_blocks_1[i], 1);
						each_blocks_1[i].m(ul0, null);
					}
				}

				group_outros();

				for (i = each_value_1.length; i < each_blocks_1.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (dirty & /*cards*/ 8) {
				each_value = /*cards*/ ctx[3];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$3(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$3(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(ul1, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out_1(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_1.length; i += 1) {
				transition_in(each_blocks_1[i]);
			}

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks_1 = each_blocks_1.filter(Boolean);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				transition_out(each_blocks_1[i]);
			}

			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div2);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$4($$self, $$props, $$invalidate) {
	let { heading } = $$props;
	let { subhead } = $$props;
	let { icon_list } = $$props;
	let { cards } = $$props;

	$$self.$$set = $$props => {
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('subhead' in $$props) $$invalidate(1, subhead = $$props.subhead);
		if ('icon_list' in $$props) $$invalidate(2, icon_list = $$props.icon_list);
		if ('cards' in $$props) $$invalidate(3, cards = $$props.cards);
	};

	return [heading, subhead, icon_list, cards];
}

class Component$5 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$4, create_fragment$5, safe_not_equal, {
			heading: 0,
			subhead: 1,
			icon_list: 2,
			cards: 3
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$4(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[3] = list[i];
	return child_ctx;
}

// (57:8) {#each buttons as button}
function create_each_block$4(ctx) {
	let a;
	let icon;
	let t0;
	let span;
	let t1_value = /*button*/ ctx[3].link.label + "";
	let t1;
	let t2;
	let a_class_value;
	let a_href_value;
	let current;
	icon = new Component$1({ props: { icon: /*button*/ ctx[3].icon } });

	return {
		c() {
			a = element("a");
			create_component(icon.$$.fragment);
			t0 = space();
			span = element("span");
			t1 = text(t1_value);
			t2 = space();
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			claim_component(icon.$$.fragment, a_nodes);
			t0 = claim_space(a_nodes);
			span = claim_element(a_nodes, "SPAN", {});
			var span_nodes = children(span);
			t1 = claim_text(span_nodes, t1_value);
			span_nodes.forEach(detach);
			t2 = claim_space(a_nodes);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", a_class_value = "" + (null_to_empty("button " + /*button*/ ctx[3].type) + " svelte-1yuktrl"));
			attr(a, "href", a_href_value = /*button*/ ctx[3].link.url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			mount_component(icon, a, null);
			append_hydration(a, t0);
			append_hydration(a, span);
			append_hydration(span, t1);
			append_hydration(a, t2);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*buttons*/ 4) icon_changes.icon = /*button*/ ctx[3].icon;
			icon.$set(icon_changes);
			if ((!current || dirty & /*buttons*/ 4) && t1_value !== (t1_value = /*button*/ ctx[3].link.label + "")) set_data(t1, t1_value);

			if (!current || dirty & /*buttons*/ 4 && a_class_value !== (a_class_value = "" + (null_to_empty("button " + /*button*/ ctx[3].type) + " svelte-1yuktrl"))) {
				attr(a, "class", a_class_value);
			}

			if (!current || dirty & /*buttons*/ 4 && a_href_value !== (a_href_value = /*button*/ ctx[3].link.url)) {
				attr(a, "href", a_href_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(a);
			destroy_component(icon);
		}
	};
}

function create_fragment$6(ctx) {
	let div4;
	let div3;
	let section;
	let div2;
	let h2;
	let t0;
	let t1;
	let div0;
	let raw_value = /*body*/ ctx[1].html + "";
	let t2;
	let div1;
	let current;
	let each_value = /*buttons*/ ctx[2];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$4(get_each_context$4(ctx, each_value, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div4 = element("div");
			div3 = element("div");
			section = element("section");
			div2 = element("div");
			h2 = element("h2");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			div0 = element("div");
			t2 = space();
			div1 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div4 = claim_element(nodes, "DIV", { class: true, id: true });
			var div4_nodes = children(div4);
			div3 = claim_element(div4_nodes, "DIV", { class: true });
			var div3_nodes = children(div3);
			section = claim_element(div3_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			div2 = claim_element(section_nodes, "DIV", { class: true });
			var div2_nodes = children(div2);
			h2 = claim_element(div2_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			t0 = claim_text(h2_nodes, /*heading*/ ctx[0]);
			h2_nodes.forEach(detach);
			t1 = claim_space(div2_nodes);
			div0 = claim_element(div2_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			div0_nodes.forEach(detach);
			t2 = claim_space(div2_nodes);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div1_nodes);
			}

			div1_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div3_nodes.forEach(detach);
			div4_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-1yuktrl");
			attr(div0, "class", "body svelte-1yuktrl");
			attr(div1, "class", "buttons svelte-1yuktrl");
			attr(div2, "class", "card svelte-1yuktrl");
			attr(section, "class", "section-container svelte-1yuktrl");
			attr(div3, "class", "background svelte-1yuktrl");
			attr(div4, "class", "section");
			attr(div4, "id", "section-791281f8");
		},
		m(target, anchor) {
			insert_hydration(target, div4, anchor);
			append_hydration(div4, div3);
			append_hydration(div3, section);
			append_hydration(section, div2);
			append_hydration(div2, h2);
			append_hydration(h2, t0);
			append_hydration(div2, t1);
			append_hydration(div2, div0);
			div0.innerHTML = raw_value;
			append_hydration(div2, t2);
			append_hydration(div2, div1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div1, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);
			if ((!current || dirty & /*body*/ 2) && raw_value !== (raw_value = /*body*/ ctx[1].html + "")) div0.innerHTML = raw_value;
			if (dirty & /*buttons*/ 4) {
				each_value = /*buttons*/ ctx[2];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$4(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$4(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div1, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div4);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$5($$self, $$props, $$invalidate) {
	let { heading } = $$props;
	let { body } = $$props;
	let { buttons } = $$props;

	$$self.$$set = $$props => {
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('body' in $$props) $$invalidate(1, body = $$props.body);
		if ('buttons' in $$props) $$invalidate(2, buttons = $$props.buttons);
	};

	return [heading, body, buttons];
}

class Component$6 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$5, create_fragment$6, safe_not_equal, { heading: 0, body: 1, buttons: 2 });
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$5(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[4] = list[i];
	return child_ctx;
}

function get_each_context_1$2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[7] = list[i].icon;
	child_ctx[8] = list[i].label;
	return child_ctx;
}

// (97:4) {#each icon_list as { icon, label }}
function create_each_block_1$2(ctx) {
	let li;
	let span0;
	let icon;
	let t0;
	let span1;
	let t1_value = /*label*/ ctx[8] + "";
	let t1;
	let t2;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[7] } });

	return {
		c() {
			li = element("li");
			span0 = element("span");
			create_component(icon.$$.fragment);
			t0 = space();
			span1 = element("span");
			t1 = text(t1_value);
			t2 = space();
			this.h();
		},
		l(nodes) {
			li = claim_element(nodes, "LI", { class: true });
			var li_nodes = children(li);
			span0 = claim_element(li_nodes, "SPAN", { class: true });
			var span0_nodes = children(span0);
			claim_component(icon.$$.fragment, span0_nodes);
			span0_nodes.forEach(detach);
			t0 = claim_space(li_nodes);
			span1 = claim_element(li_nodes, "SPAN", {});
			var span1_nodes = children(span1);
			t1 = claim_text(span1_nodes, t1_value);
			span1_nodes.forEach(detach);
			t2 = claim_space(li_nodes);
			li_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span0, "class", "icon svelte-7sz6s1");
			attr(li, "class", "svelte-7sz6s1");
		},
		m(target, anchor) {
			insert_hydration(target, li, anchor);
			append_hydration(li, span0);
			mount_component(icon, span0, null);
			append_hydration(li, t0);
			append_hydration(li, span1);
			append_hydration(span1, t1);
			append_hydration(li, t2);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*icon_list*/ 4) icon_changes.icon = /*icon*/ ctx[7];
			icon.$set(icon_changes);
			if ((!current || dirty & /*icon_list*/ 4) && t1_value !== (t1_value = /*label*/ ctx[8] + "")) set_data(t1, t1_value);
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(icon);
		}
	};
}

// (107:4) {#each cards as card}
function create_each_block$5(ctx) {
	let li;
	let div0;
	let icon;
	let t0;
	let div2;
	let h3;
	let t1_value = /*card*/ ctx[4].title + "";
	let t1;
	let t2;
	let div1;
	let raw_value = /*card*/ ctx[4].content.html + "";
	let t3;
	let a;
	let span;
	let t4_value = /*card*/ ctx[4].link.label + "";
	let t4;
	let a_href_value;
	let t5;
	let current;
	icon = new Component$1({ props: { icon: /*card*/ ctx[4].icon } });

	return {
		c() {
			li = element("li");
			div0 = element("div");
			create_component(icon.$$.fragment);
			t0 = space();
			div2 = element("div");
			h3 = element("h3");
			t1 = text(t1_value);
			t2 = space();
			div1 = element("div");
			t3 = space();
			a = element("a");
			span = element("span");
			t4 = text(t4_value);
			t5 = space();
			this.h();
		},
		l(nodes) {
			li = claim_element(nodes, "LI", { class: true });
			var li_nodes = children(li);
			div0 = claim_element(li_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			claim_component(icon.$$.fragment, div0_nodes);
			div0_nodes.forEach(detach);
			t0 = claim_space(li_nodes);
			div2 = claim_element(li_nodes, "DIV", { class: true });
			var div2_nodes = children(div2);
			h3 = claim_element(div2_nodes, "H3", { class: true });
			var h3_nodes = children(h3);
			t1 = claim_text(h3_nodes, t1_value);
			h3_nodes.forEach(detach);
			t2 = claim_space(div2_nodes);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			div1_nodes.forEach(detach);
			t3 = claim_space(div2_nodes);
			a = claim_element(div2_nodes, "A", { href: true, class: true });
			var a_nodes = children(a);
			span = claim_element(a_nodes, "SPAN", {});
			var span_nodes = children(span);
			t4 = claim_text(span_nodes, t4_value);
			span_nodes.forEach(detach);
			a_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			t5 = claim_space(li_nodes);
			li_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div0, "class", "icon svelte-7sz6s1");
			attr(h3, "class", "title svelte-7sz6s1");
			attr(div1, "class", "content svelte-7sz6s1");
			attr(a, "href", a_href_value = /*card*/ ctx[4].link.url);
			attr(a, "class", "link svelte-7sz6s1");
			attr(div2, "class", "body svelte-7sz6s1");
			attr(li, "class", "svelte-7sz6s1");
		},
		m(target, anchor) {
			insert_hydration(target, li, anchor);
			append_hydration(li, div0);
			mount_component(icon, div0, null);
			append_hydration(li, t0);
			append_hydration(li, div2);
			append_hydration(div2, h3);
			append_hydration(h3, t1);
			append_hydration(div2, t2);
			append_hydration(div2, div1);
			div1.innerHTML = raw_value;
			append_hydration(div2, t3);
			append_hydration(div2, a);
			append_hydration(a, span);
			append_hydration(span, t4);
			append_hydration(li, t5);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*cards*/ 8) icon_changes.icon = /*card*/ ctx[4].icon;
			icon.$set(icon_changes);
			if ((!current || dirty & /*cards*/ 8) && t1_value !== (t1_value = /*card*/ ctx[4].title + "")) set_data(t1, t1_value);
			if ((!current || dirty & /*cards*/ 8) && raw_value !== (raw_value = /*card*/ ctx[4].content.html + "")) div1.innerHTML = raw_value;			if ((!current || dirty & /*cards*/ 8) && t4_value !== (t4_value = /*card*/ ctx[4].link.label + "")) set_data(t4, t4_value);

			if (!current || dirty & /*cards*/ 8 && a_href_value !== (a_href_value = /*card*/ ctx[4].link.url)) {
				attr(a, "href", a_href_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(icon);
		}
	};
}

function create_fragment$7(ctx) {
	let div1;
	let section;
	let header;
	let h2;
	let t0;
	let div0;
	let t1;
	let t2;
	let ul0;
	let t3;
	let ul1;
	let current;
	let each_value_1 = /*icon_list*/ ctx[2];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1$2(get_each_context_1$2(ctx, each_value_1, i));
	}

	const out = i => transition_out(each_blocks_1[i], 1, 1, () => {
		each_blocks_1[i] = null;
	});

	let each_value = /*cards*/ ctx[3];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$5(get_each_context$5(ctx, each_value, i));
	}

	const out_1 = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div1 = element("div");
			section = element("section");
			header = element("header");
			h2 = element("h2");
			t0 = space();
			div0 = element("div");
			t1 = text(/*subhead*/ ctx[1]);
			t2 = space();
			ul0 = element("ul");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t3 = space();
			ul1 = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			section = claim_element(div1_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			header = claim_element(section_nodes, "HEADER", { class: true });
			var header_nodes = children(header);
			h2 = claim_element(header_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			h2_nodes.forEach(detach);
			t0 = claim_space(header_nodes);
			div0 = claim_element(header_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			t1 = claim_text(div0_nodes, /*subhead*/ ctx[1]);
			div0_nodes.forEach(detach);
			header_nodes.forEach(detach);
			t2 = claim_space(section_nodes);
			ul0 = claim_element(section_nodes, "UL", { class: true });
			var ul0_nodes = children(ul0);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].l(ul0_nodes);
			}

			ul0_nodes.forEach(detach);
			t3 = claim_space(section_nodes);
			ul1 = claim_element(section_nodes, "UL", { class: true });
			var ul1_nodes = children(ul1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(ul1_nodes);
			}

			ul1_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading svelte-7sz6s1");
			attr(div0, "class", "subheading");
			attr(header, "class", "heading-group svelte-7sz6s1");
			attr(ul0, "class", "icon-list svelte-7sz6s1");
			attr(ul1, "class", "cards svelte-7sz6s1");
			attr(section, "class", "section-container svelte-7sz6s1");
			attr(div1, "class", "section");
			attr(div1, "id", "section-248b2650");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, section);
			append_hydration(section, header);
			append_hydration(header, h2);
			h2.innerHTML = /*heading*/ ctx[0];
			append_hydration(header, t0);
			append_hydration(header, div0);
			append_hydration(div0, t1);
			append_hydration(section, t2);
			append_hydration(section, ul0);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(ul0, null);
				}
			}

			append_hydration(section, t3);
			append_hydration(section, ul1);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(ul1, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) h2.innerHTML = /*heading*/ ctx[0];			if (!current || dirty & /*subhead*/ 2) set_data(t1, /*subhead*/ ctx[1]);

			if (dirty & /*icon_list*/ 4) {
				each_value_1 = /*icon_list*/ ctx[2];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$2(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
						transition_in(each_blocks_1[i], 1);
					} else {
						each_blocks_1[i] = create_each_block_1$2(child_ctx);
						each_blocks_1[i].c();
						transition_in(each_blocks_1[i], 1);
						each_blocks_1[i].m(ul0, null);
					}
				}

				group_outros();

				for (i = each_value_1.length; i < each_blocks_1.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (dirty & /*cards*/ 8) {
				each_value = /*cards*/ ctx[3];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$5(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$5(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(ul1, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out_1(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_1.length; i += 1) {
				transition_in(each_blocks_1[i]);
			}

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks_1 = each_blocks_1.filter(Boolean);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				transition_out(each_blocks_1[i]);
			}

			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$6($$self, $$props, $$invalidate) {
	let { heading } = $$props;
	let { subhead } = $$props;
	let { icon_list } = $$props;
	let { cards } = $$props;

	$$self.$$set = $$props => {
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('subhead' in $$props) $$invalidate(1, subhead = $$props.subhead);
		if ('icon_list' in $$props) $$invalidate(2, icon_list = $$props.icon_list);
		if ('cards' in $$props) $$invalidate(3, cards = $$props.cards);
	};

	return [heading, subhead, icon_list, cards];
}

class Component$7 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$6, create_fragment$7, safe_not_equal, {
			heading: 0,
			subhead: 1,
			icon_list: 2,
			cards: 3
		});
	}
}

/* generated by Svelte v3.58.0 */

function create_fragment$8(ctx) {
	let div1;
	let div0;
	let hr;

	return {
		c() {
			div1 = element("div");
			div0 = element("div");
			hr = element("hr");
			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			div0 = claim_element(div1_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			hr = claim_element(div0_nodes, "HR", {});
			div0_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div0, "class", "section-container svelte-1h2ifr1");
			attr(div1, "class", "section");
			attr(div1, "id", "section-dc1b60d5");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, div0);
			append_hydration(div0, hr);
		},
		p: noop,
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div1);
		}
	};
}

class Component$8 extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment$8, safe_not_equal, {});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$6(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[5] = list[i];
	child_ctx[7] = i;
	return child_ctx;
}

function get_each_context_1$3(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[8] = list[i].link;
	child_ctx[9] = list[i].icon;
	return child_ctx;
}

// (95:6) {#each social as { link, icon }}
function create_each_block_1$3(ctx) {
	let a;
	let span;
	let icon;
	let t0;
	let t1_value = /*link*/ ctx[8].label + "";
	let t1;
	let t2;
	let a_href_value;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[9] } });

	return {
		c() {
			a = element("a");
			span = element("span");
			create_component(icon.$$.fragment);
			t0 = space();
			t1 = text(t1_value);
			t2 = space();
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { href: true, class: true });
			var a_nodes = children(a);
			span = claim_element(a_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			claim_component(icon.$$.fragment, span_nodes);
			span_nodes.forEach(detach);
			t0 = claim_space(a_nodes);
			t1 = claim_text(a_nodes, t1_value);
			t2 = claim_space(a_nodes);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span, "class", "icon svelte-12jj5ao");
			attr(a, "href", a_href_value = /*link*/ ctx[8].url);
			attr(a, "class", "svelte-12jj5ao");
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, span);
			mount_component(icon, span, null);
			append_hydration(a, t0);
			append_hydration(a, t1);
			append_hydration(a, t2);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*social*/ 4) icon_changes.icon = /*icon*/ ctx[9];
			icon.$set(icon_changes);
			if ((!current || dirty & /*social*/ 4) && t1_value !== (t1_value = /*link*/ ctx[8].label + "")) set_data(t1, t1_value);

			if (!current || dirty & /*social*/ 4 && a_href_value !== (a_href_value = /*link*/ ctx[8].url)) {
				attr(a, "href", a_href_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(a);
			destroy_component(icon);
		}
	};
}

// (112:6) {:else}
function create_else_block$1(ctx) {
	let label;
	let span;
	let t0_value = /*input*/ ctx[5].label + "";
	let t0;
	let t1;
	let input;
	let input_type_value;
	let input_placeholder_value;

	return {
		c() {
			label = element("label");
			span = element("span");
			t0 = text(t0_value);
			t1 = space();
			input = element("input");
			this.h();
		},
		l(nodes) {
			label = claim_element(nodes, "LABEL", { class: true });
			var label_nodes = children(label);
			span = claim_element(label_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			t0 = claim_text(span_nodes, t0_value);
			span_nodes.forEach(detach);
			t1 = claim_space(label_nodes);

			input = claim_element(label_nodes, "INPUT", {
				type: true,
				placeholder: true,
				class: true
			});

			label_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span, "class", "svelte-12jj5ao");
			attr(input, "type", input_type_value = /*input*/ ctx[5].type || "text");
			attr(input, "placeholder", input_placeholder_value = /*input*/ ctx[5].placeholder);
			attr(input, "class", "svelte-12jj5ao");
			attr(label, "class", "svelte-12jj5ao");
		},
		m(target, anchor) {
			insert_hydration(target, label, anchor);
			append_hydration(label, span);
			append_hydration(span, t0);
			append_hydration(label, t1);
			append_hydration(label, input);
		},
		p(ctx, dirty) {
			if (dirty & /*inputs*/ 8 && t0_value !== (t0_value = /*input*/ ctx[5].label + "")) set_data(t0, t0_value);

			if (dirty & /*inputs*/ 8 && input_type_value !== (input_type_value = /*input*/ ctx[5].type || "text")) {
				attr(input, "type", input_type_value);
			}

			if (dirty & /*inputs*/ 8 && input_placeholder_value !== (input_placeholder_value = /*input*/ ctx[5].placeholder)) {
				attr(input, "placeholder", input_placeholder_value);
			}
		},
		d(detaching) {
			if (detaching) detach(label);
		}
	};
}

// (107:6) {#if input.type === "textarea"}
function create_if_block$3(ctx) {
	let label;
	let span;
	let t0_value = /*input*/ ctx[5].label + "";
	let t0;
	let t1;
	let textarea;

	return {
		c() {
			label = element("label");
			span = element("span");
			t0 = text(t0_value);
			t1 = space();
			textarea = element("textarea");
			this.h();
		},
		l(nodes) {
			label = claim_element(nodes, "LABEL", { class: true });
			var label_nodes = children(label);
			span = claim_element(label_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			t0 = claim_text(span_nodes, t0_value);
			span_nodes.forEach(detach);
			t1 = claim_space(label_nodes);
			textarea = claim_element(label_nodes, "TEXTAREA", { class: true });
			children(textarea).forEach(detach);
			label_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(span, "class", "svelte-12jj5ao");
			attr(textarea, "class", "svelte-12jj5ao");
			attr(label, "class", "svelte-12jj5ao");
		},
		m(target, anchor) {
			insert_hydration(target, label, anchor);
			append_hydration(label, span);
			append_hydration(span, t0);
			append_hydration(label, t1);
			append_hydration(label, textarea);
		},
		p(ctx, dirty) {
			if (dirty & /*inputs*/ 8 && t0_value !== (t0_value = /*input*/ ctx[5].label + "")) set_data(t0, t0_value);
		},
		d(detaching) {
			if (detaching) detach(label);
		}
	};
}

// (106:4) {#each inputs as input, i}
function create_each_block$6(ctx) {
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (/*input*/ ctx[5].type === "textarea") return create_if_block$3;
		return create_else_block$1;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

function create_fragment$9(ctx) {
	let div3;
	let section;
	let div2;
	let h2;
	let t0;
	let t1;
	let div0;
	let t2;
	let div1;
	let t3;
	let form;
	let t4;
	let button;
	let t5;
	let current;
	let each_value_1 = /*social*/ ctx[2];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1$3(get_each_context_1$3(ctx, each_value_1, i));
	}

	const out = i => transition_out(each_blocks_1[i], 1, 1, () => {
		each_blocks_1[i] = null;
	});

	let each_value = /*inputs*/ ctx[3];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$6(get_each_context$6(ctx, each_value, i));
	}

	return {
		c() {
			div3 = element("div");
			section = element("section");
			div2 = element("div");
			h2 = element("h2");
			t0 = text(/*heading*/ ctx[0]);
			t1 = space();
			div0 = element("div");
			t2 = space();
			div1 = element("div");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t3 = space();
			form = element("form");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t4 = space();
			button = element("button");
			t5 = text(/*submit_label*/ ctx[4]);
			this.h();
		},
		l(nodes) {
			div3 = claim_element(nodes, "DIV", { class: true, id: true });
			var div3_nodes = children(div3);
			section = claim_element(div3_nodes, "SECTION", { class: true });
			var section_nodes = children(section);
			div2 = claim_element(section_nodes, "DIV", { class: true });
			var div2_nodes = children(div2);
			h2 = claim_element(div2_nodes, "H2", { class: true });
			var h2_nodes = children(h2);
			t0 = claim_text(h2_nodes, /*heading*/ ctx[0]);
			h2_nodes.forEach(detach);
			t1 = claim_space(div2_nodes);
			div0 = claim_element(div2_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			div0_nodes.forEach(detach);
			t2 = claim_space(div2_nodes);
			div1 = claim_element(div2_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].l(div1_nodes);
			}

			div1_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			t3 = claim_space(section_nodes);
			form = claim_element(section_nodes, "FORM", { class: true });
			var form_nodes = children(form);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(form_nodes);
			}

			t4 = claim_space(form_nodes);
			button = claim_element(form_nodes, "BUTTON", { class: true, type: true });
			var button_nodes = children(button);
			t5 = claim_text(button_nodes, /*submit_label*/ ctx[4]);
			button_nodes.forEach(detach);
			form_nodes.forEach(detach);
			section_nodes.forEach(detach);
			div3_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(h2, "class", "heading");
			attr(div0, "class", "body svelte-12jj5ao");
			attr(div1, "class", "social-links svelte-12jj5ao");
			attr(div2, "class", "content svelte-12jj5ao");
			attr(button, "class", "button primary positive svelte-12jj5ao");
			attr(button, "type", "submit");
			attr(form, "class", "svelte-12jj5ao");
			attr(section, "class", "section-container svelte-12jj5ao");
			attr(div3, "class", "section");
			attr(div3, "id", "section-352791c5");
		},
		m(target, anchor) {
			insert_hydration(target, div3, anchor);
			append_hydration(div3, section);
			append_hydration(section, div2);
			append_hydration(div2, h2);
			append_hydration(h2, t0);
			append_hydration(div2, t1);
			append_hydration(div2, div0);
			div0.innerHTML = /*subheading*/ ctx[1];
			append_hydration(div2, t2);
			append_hydration(div2, div1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(div1, null);
				}
			}

			append_hydration(section, t3);
			append_hydration(section, form);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(form, null);
				}
			}

			append_hydration(form, t4);
			append_hydration(form, button);
			append_hydration(button, t5);
			current = true;
		},
		p(ctx, [dirty]) {
			if (!current || dirty & /*heading*/ 1) set_data(t0, /*heading*/ ctx[0]);
			if (!current || dirty & /*subheading*/ 2) div0.innerHTML = /*subheading*/ ctx[1];
			if (dirty & /*social*/ 4) {
				each_value_1 = /*social*/ ctx[2];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$3(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
						transition_in(each_blocks_1[i], 1);
					} else {
						each_blocks_1[i] = create_each_block_1$3(child_ctx);
						each_blocks_1[i].c();
						transition_in(each_blocks_1[i], 1);
						each_blocks_1[i].m(div1, null);
					}
				}

				group_outros();

				for (i = each_value_1.length; i < each_blocks_1.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (dirty & /*inputs*/ 8) {
				each_value = /*inputs*/ ctx[3];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$6(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block$6(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(form, t4);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}

			if (!current || dirty & /*submit_label*/ 16) set_data(t5, /*submit_label*/ ctx[4]);
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_1.length; i += 1) {
				transition_in(each_blocks_1[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks_1 = each_blocks_1.filter(Boolean);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				transition_out(each_blocks_1[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div3);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$7($$self, $$props, $$invalidate) {
	let { heading } = $$props;
	let { subheading } = $$props;
	let { social } = $$props;
	let { inputs } = $$props;
	let { submit_label } = $$props;

	$$self.$$set = $$props => {
		if ('heading' in $$props) $$invalidate(0, heading = $$props.heading);
		if ('subheading' in $$props) $$invalidate(1, subheading = $$props.subheading);
		if ('social' in $$props) $$invalidate(2, social = $$props.social);
		if ('inputs' in $$props) $$invalidate(3, inputs = $$props.inputs);
		if ('submit_label' in $$props) $$invalidate(4, submit_label = $$props.submit_label);
	};

	return [heading, subheading, social, inputs, submit_label];
}

class Component$9 extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$7, create_fragment$9, safe_not_equal, {
			heading: 0,
			subheading: 1,
			social: 2,
			inputs: 3,
			submit_label: 4
		});
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$7(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[1] = list[i].link;
	return child_ctx;
}

// (31:4) {#each footer_links as { link }}
function create_each_block$7(ctx) {
	let a;
	let t_value = /*link*/ ctx[1].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link");
			attr(a, "href", a_href_value = /*link*/ ctx[1].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*footer_links*/ 1 && t_value !== (t_value = /*link*/ ctx[1].label + "")) set_data(t, t_value);

			if (dirty & /*footer_links*/ 1 && a_href_value !== (a_href_value = /*link*/ ctx[1].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

function create_fragment$a(ctx) {
	let div1;
	let footer;
	let div0;
	let nav;
	let t0;
	let span;
	let t1;
	let a;
	let t2;
	let each_value = /*footer_links*/ ctx[0];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$7(get_each_context$7(ctx, each_value, i));
	}

	return {
		c() {
			div1 = element("div");
			footer = element("footer");
			div0 = element("div");
			nav = element("nav");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t0 = space();
			span = element("span");
			t1 = text("Powered by\n    ");
			a = element("a");
			t2 = text("Primo");
			this.h();
		},
		l(nodes) {
			div1 = claim_element(nodes, "DIV", { class: true, id: true });
			var div1_nodes = children(div1);
			footer = claim_element(div1_nodes, "FOOTER", { class: true });
			var footer_nodes = children(footer);
			div0 = claim_element(footer_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);
			nav = claim_element(div0_nodes, "NAV", { class: true });
			var nav_nodes = children(nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nav_nodes);
			}

			nav_nodes.forEach(detach);
			t0 = claim_space(div0_nodes);
			span = claim_element(div0_nodes, "SPAN", { class: true });
			var span_nodes = children(span);
			t1 = claim_text(span_nodes, "Powered by\n    ");
			a = claim_element(span_nodes, "A", { href: true, class: true });
			var a_nodes = children(a);
			t2 = claim_text(a_nodes, "Primo");
			a_nodes.forEach(detach);
			span_nodes.forEach(detach);
			div0_nodes.forEach(detach);
			footer_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(nav, "class", "svelte-1wofe1u");
			attr(a, "href", "https://primo.so");
			attr(a, "class", "primo svelte-1wofe1u");
			attr(span, "class", "primo svelte-1wofe1u");
			attr(div0, "class", "section-container svelte-1wofe1u");
			attr(footer, "class", "svelte-1wofe1u");
			attr(div1, "class", "section");
			attr(div1, "id", "section-910f8de4");
		},
		m(target, anchor) {
			insert_hydration(target, div1, anchor);
			append_hydration(div1, footer);
			append_hydration(footer, div0);
			append_hydration(div0, nav);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(nav, null);
				}
			}

			append_hydration(div0, t0);
			append_hydration(div0, span);
			append_hydration(span, t1);
			append_hydration(span, a);
			append_hydration(a, t2);
		},
		p(ctx, [dirty]) {
			if (dirty & /*footer_links*/ 1) {
				each_value = /*footer_links*/ ctx[0];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$7(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block$7(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(nav, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div1);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$8($$self, $$props, $$invalidate) {
	let { footer_links } = $$props;

	$$self.$$set = $$props => {
		if ('footer_links' in $$props) $$invalidate(0, footer_links = $$props.footer_links);
	};

	return [footer_links];
}

class Component$a extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$8, create_fragment$a, safe_not_equal, { footer_links: 0 });
	}
}

/* generated by Svelte v3.58.0 */

function get_each_context$8(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[2] = list[i].link;
	child_ctx[3] = list[i].icon;
	return child_ctx;
}

function get_each_context_1$4(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[2] = list[i].link;
	return child_ctx;
}

// (72:4) {#each nav as { link }}
function create_each_block_1$4(ctx) {
	let a;
	let t_value = /*link*/ ctx[2].label + "";
	let t;
	let a_href_value;

	return {
		c() {
			a = element("a");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", { class: true, href: true });
			var a_nodes = children(a);
			t = claim_text(a_nodes, t_value);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "class", "link svelte-90rszg");
			attr(a, "href", a_href_value = /*link*/ ctx[2].url);
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			append_hydration(a, t);
		},
		p(ctx, dirty) {
			if (dirty & /*nav*/ 1 && t_value !== (t_value = /*link*/ ctx[2].label + "")) set_data(t, t_value);

			if (dirty & /*nav*/ 1 && a_href_value !== (a_href_value = /*link*/ ctx[2].url)) {
				attr(a, "href", a_href_value);
			}
		},
		d(detaching) {
			if (detaching) detach(a);
		}
	};
}

// (77:4) {#each social as { link, icon }}
function create_each_block$8(ctx) {
	let a;
	let icon;
	let t;
	let a_href_value;
	let a_aria_label_value;
	let current;
	icon = new Component$1({ props: { icon: /*icon*/ ctx[3] } });

	return {
		c() {
			a = element("a");
			create_component(icon.$$.fragment);
			t = space();
			this.h();
		},
		l(nodes) {
			a = claim_element(nodes, "A", {
				href: true,
				"aria-label": true,
				class: true
			});

			var a_nodes = children(a);
			claim_component(icon.$$.fragment, a_nodes);
			t = claim_space(a_nodes);
			a_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(a, "href", a_href_value = /*link*/ ctx[2].url);
			attr(a, "aria-label", a_aria_label_value = /*link*/ ctx[2].label);
			attr(a, "class", "svelte-90rszg");
		},
		m(target, anchor) {
			insert_hydration(target, a, anchor);
			mount_component(icon, a, null);
			append_hydration(a, t);
			current = true;
		},
		p(ctx, dirty) {
			const icon_changes = {};
			if (dirty & /*social*/ 2) icon_changes.icon = /*icon*/ ctx[3];
			icon.$set(icon_changes);

			if (!current || dirty & /*social*/ 2 && a_href_value !== (a_href_value = /*link*/ ctx[2].url)) {
				attr(a, "href", a_href_value);
			}

			if (!current || dirty & /*social*/ 2 && a_aria_label_value !== (a_aria_label_value = /*link*/ ctx[2].label)) {
				attr(a, "aria-label", a_aria_label_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(icon.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(icon.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(a);
			destroy_component(icon);
		}
	};
}

function create_fragment$b(ctx) {
	let div2;
	let footer;
	let div1;
	let nav_1;
	let t;
	let div0;
	let current;
	let each_value_1 = /*nav*/ ctx[0];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks_1[i] = create_each_block_1$4(get_each_context_1$4(ctx, each_value_1, i));
	}

	let each_value = /*social*/ ctx[1];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block$8(get_each_context$8(ctx, each_value, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			div2 = element("div");
			footer = element("footer");
			div1 = element("div");
			nav_1 = element("nav");

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t = space();
			div0 = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			this.h();
		},
		l(nodes) {
			div2 = claim_element(nodes, "DIV", { class: true, id: true });
			var div2_nodes = children(div2);
			footer = claim_element(div2_nodes, "FOOTER", { class: true });
			var footer_nodes = children(footer);
			div1 = claim_element(footer_nodes, "DIV", { class: true });
			var div1_nodes = children(div1);
			nav_1 = claim_element(div1_nodes, "NAV", { class: true });
			var nav_1_nodes = children(nav_1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].l(nav_1_nodes);
			}

			nav_1_nodes.forEach(detach);
			t = claim_space(div1_nodes);
			div0 = claim_element(div1_nodes, "DIV", { class: true });
			var div0_nodes = children(div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(div0_nodes);
			}

			div0_nodes.forEach(detach);
			div1_nodes.forEach(detach);
			footer_nodes.forEach(detach);
			div2_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(nav_1, "class", "svelte-90rszg");
			attr(div0, "class", "social-links svelte-90rszg");
			attr(div1, "class", "section-container svelte-90rszg");
			attr(footer, "class", "svelte-90rszg");
			attr(div2, "class", "section");
			attr(div2, "id", "section-46899b77");
		},
		m(target, anchor) {
			insert_hydration(target, div2, anchor);
			append_hydration(div2, footer);
			append_hydration(footer, div1);
			append_hydration(div1, nav_1);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				if (each_blocks_1[i]) {
					each_blocks_1[i].m(nav_1, null);
				}
			}

			append_hydration(div1, t);
			append_hydration(div1, div0);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(div0, null);
				}
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (dirty & /*nav*/ 1) {
				each_value_1 = /*nav*/ ctx[0];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1$4(ctx, each_value_1, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
					} else {
						each_blocks_1[i] = create_each_block_1$4(child_ctx);
						each_blocks_1[i].c();
						each_blocks_1[i].m(nav_1, null);
					}
				}

				for (; i < each_blocks_1.length; i += 1) {
					each_blocks_1[i].d(1);
				}

				each_blocks_1.length = each_value_1.length;
			}

			if (dirty & /*social*/ 2) {
				each_value = /*social*/ ctx[1];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context$8(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block$8(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div0, null);
					}
				}

				group_outros();

				for (i = each_value.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div2);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
		}
	};
}

function instance$9($$self, $$props, $$invalidate) {
	let { nav } = $$props;
	let { social } = $$props;

	$$self.$$set = $$props => {
		if ('nav' in $$props) $$invalidate(0, nav = $$props.nav);
		if ('social' in $$props) $$invalidate(1, social = $$props.social);
	};

	return [nav, social];
}

class Component$b extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$9, create_fragment$b, safe_not_equal, { nav: 0, social: 1 });
	}
}

/* generated by Svelte v3.58.0 */

class Component$c extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, null, safe_not_equal, {});
	}
}

/* generated by Svelte v3.58.0 */

function create_fragment$c(ctx) {
	let component_0;
	let t0;
	let component_1;
	let t1;
	let component_2;
	let t2;
	let component_3;
	let t3;
	let component_4;
	let t4;
	let component_5;
	let t5;
	let component_6;
	let t6;
	let component_7;
	let t7;
	let component_8;
	let t8;
	let component_9;
	let t9;
	let component_10;
	let t10;
	let component_11;
	let current;
	component_0 = new Component({});

	component_1 = new Component$2({
			props: {
				background: {
					"alt": "",
					"src": "https://jomjtsrkhfmfxfsrnsdc.supabase.co/storage/v1/object/public/images/96af8c14-edea-46c2-9147-dd18617b64b0/1690213799336cercavila-escoles-19-b.jpg",
					"url": "https://jomjtsrkhfmfxfsrnsdc.supabase.co/storage/v1/object/public/images/96af8c14-edea-46c2-9147-dd18617b64b0/1690213799336cercavila-escoles-19-b.jpg",
					"size": 623
				},
				headline: "",
				logo: {
					"image": {
						"alt": "",
						"src": "https://jomjtsrkhfmfxfsrnsdc.supabase.co/storage/v1/object/public/images/96af8c14-edea-46c2-9147-dd18617b64b0/1690210337748primer-dia-escola-2021-14-ok.jpeg",
						"url": "https://jomjtsrkhfmfxfsrnsdc.supabase.co/storage/v1/object/public/images/96af8c14-edea-46c2-9147-dd18617b64b0/1690210337748primer-dia-escola-2021-14-ok.jpeg",
						"size": 811
					},
					"title": "AFA Pi d'en Xandri"
				},
				site_nav: [
					{
						"link": { "url": "/qui-som", "label": "Qui som?" }
					},
					{
						"link": {
							"url": "/comissions",
							"label": "Comissions"
						}
					},
					{
						"link": {
							"url": "/projectes",
							"label": "Projectes"
						}
					},
					{
						"link": {
							"url": "/notcies-i-activitats",
							"label": "Notícies i activitats"
						}
					},
					{
						"link": {
							"url": "/curs-2023-24",
							"label": "Curs 2023-24"
						}
					},
					{
						"link": {
							"url": "/documents",
							"label": "Documents"
						}
					}
				]
			}
		});

	component_2 = new Component$3({
			props: {
				heading: "",
				subheading: "L’AFA és una associació de mares i pares d’alumnes sense afany de lucre que busca millorar la qualitat del sistema educatiu i les condicions d’escolarització del centre. Fotografia de portada: Bernat Millet",
				buttons: []
			}
		});

	component_3 = new Component$4({
			props: {
				heading: "Coneix les nostres comissions",
				cards: [
					{
						"icon": "material-symbols:groups",
						"title": "Delegats",
						"description": {
							"html": "<p>Coordina les accions dels delegats i marca les pautes a seguir amb la seva feina.</p>",
							"markdown": "Coordina les accions dels delegats i marca les pautes a seguir amb la seva feina.\n\n"
						}
					},
					{
						"icon": "material-symbols:filter-vintage",
						"title": "Coeducació Calidoscopi",
						"description": {
							"html": "<p>Dóna suport a l’escola en l’educació en la pau i en el respecte als altres.</p>",
							"markdown": "Dóna suport a l’escola en l’educació en la pau i en el respecte als altres."
						}
					},
					{
						"icon": "material-symbols:school",
						"title": "Educativa",
						"description": {
							"html": "<p>Suport a l’escola en el desenvolupament del projecte educatiu.</p>",
							"markdown": "Suport a l’escola en el desenvolupament del projecte educatiu.\n\n"
						}
					},
					{
						"icon": "material-symbols:science",
						"title": "Science & Tech",
						"description": {
							"html": "<p>Col·labora amb l’escola per millorar la difusió de la ciència i tecnologia. </p>",
							"markdown": "Col·labora amb l’escola per millorar la difusió de la ciència i tecnologia. "
						}
					},
					{
						"icon": "material-symbols:eco",
						"title": "Sostenibilitat",
						"description": {
							"html": "<p>Reducció de l’impacte ambiental i conscienciació de la comunitat escolar.</p>",
							"markdown": "Reducció de l’impacte ambiental i conscienciació de la comunitat escolar."
						}
					},
					{
						"icon": "material-symbols:styler",
						"title": "Tèxtil",
						"description": {
							"html": "<p>Ven material tèxtil d'identificació pels Xandris en sortides escolars.</p>",
							"markdown": "Ven material tèxtil d'identificació pels Xandris en sortides escolars."
						}
					},
					{
						"icon": "material-symbols:nightlife",
						"title": "Bar",
						"description": {
							"html": "<p>Encarregada del bar de la festa final de curs i font principal de finançament de AFA.</p>",
							"markdown": "Encarregada del bar de la festa final de curs i font principal de finançament de AFA."
						}
					},
					{
						"icon": "material-symbols:campaign",
						"title": "Comunicació",
						"description": {
							"html": "<p>S’ocupa de fer arribar a les famílies de l’Escola tota la informació de l'AFA.</p>",
							"markdown": "S’ocupa de fer arribar a les famílies de l’Escola tota la informació de l'AFA.\n"
						}
					},
					{
						"icon": "material-symbols:interactive-space",
						"title": "Escola de pares",
						"description": {
							"html": "<p>Formació en temes psicològics, pedagògics i socials per a les famílies de l’escola.</p>",
							"markdown": "Formació en temes psicològics, pedagògics i socials per a les famílies de l’escola."
						}
					},
					{
						"icon": "material-symbols:sports-basketball",
						"title": "Extraescolars",
						"description": {
							"html": "<p>Col·laboració amb Paidos en serveis d’extraescolars, acollida, casals i colònies.</p>",
							"markdown": "Col·laboració amb Paidos en serveis d’extraescolars, acollida, casals i colònies."
						}
					},
					{
						"icon": "material-symbols:person-celebrate",
						"title": "Festes",
						"description": {
							"html": "<p>Organitza festes durant l’any en col·laboració amb l'escola i és la responsable del Pinyot.</p>",
							"markdown": "Organitza festes durant l’any en col·laboració amb l'escola i és la responsable del Pinyot."
						}
					},
					{
						"icon": "material-symbols:tools-power-drill",
						"title": "Infraestructures",
						"description": {
							"html": "<p>Col·labora amb l’Ajuntament per resoldre possibles  problemes d'infrastuctura de l'escola. .</p>",
							"markdown": "Col·labora amb l’Ajuntament per resoldre possibles  problemes d'infrastuctura de l'escola. ."
						}
					},
					{
						"icon": "material-symbols:local-library",
						"title": "Llibres",
						"description": {
							"html": "<p>Col·labora amb l’escola en la gestió dels llibres socialitzats  i organitza la venda de llibres.</p>",
							"markdown": "Col·labora amb l’escola en la gestió dels llibres socialitzats  i organitza la venda de llibres."
						}
					},
					{
						"icon": "material-symbols:local-dining",
						"title": "Menjador",
						"description": {
							"html": "<p>Col·labora amb Paidos en del servei de menjador i temps de migdia fent seguiment i control.</p>",
							"markdown": "Col·labora amb Paidos en del servei de menjador i temps de migdia fent seguiment i control.\n\n"
						}
					},
					{
						"icon": "material-symbols:psychology-alt",
						"title": "Savi",
						"description": {
							"html": "<p>Organitza el Savi, el concurs més divertit pels pares i mares de l’escola</p>",
							"markdown": "Organitza el Savi, el concurs més divertit pels pares i mares de l’escola\n\n"
						}
					}
				]
			}
		});

	component_4 = new Component$5({
			props: {
				heading: "Properes activitats",
				subhead: "",
				icon_list: [],
				cards: [
					{
						"icon": "akar-icons:calendar",
						"link": {
							"url": "https://www.sostenible.cat/acte/setmana-europea-de-la-mobilitat-a-sant-cugat-del-valles",
							"label": "Llegeix més"
						},
						"title": "Setmana europea de la mobilitat",
						"content": {
							"html": "<p>Sept 16-22, 2023</p>",
							"markdown": "Sept 16-22, 2023\n\n"
						}
					},
					{
						"icon": "akar-icons:calendar",
						"link": {
							"url": "/projectes/gestio-de-textil",
							"label": "Llegeix més"
						},
						"title": "Venda de textil: FORA STOCKS!",
						"content": {
							"html": "<p>Sept 22, 2023</p>",
							"markdown": "Sept 22, 2023\n\n"
						}
					},
					{
						"icon": "akar-icons:calendar",
						"link": {
							"url": "/projectes",
							"label": "Afegeix al teu calendari"
						},
						"title": "Assemblea de l'AFA inici de curs",
						"content": {
							"html": "<p>Sept 25, 2023 </p>",
							"markdown": "Sept 25, 2023 "
						}
					}
				]
			}
		});

	component_5 = new Component$6({
			props: {
				heading: "Vols formar part de l'AFA?",
				body: {
					"html": "<p>Hi ha molts projectes per fer i us encoratgem a col·laborar en les comissions de l'AFA que us cridin l'atenció. Cadascú pot fer la seva contribució, col·laborant segons la seva disponibilitat i interès.</p>",
					"markdown": "Hi ha molts projectes per fer i us encoratgem a col·laborar en les comissions de l'AFA que us cridin l'atenció. Cadascú pot fer la seva contribució, col·laborant segons la seva disponibilitat i interès.\n"
				},
				buttons: [
					{
						"icon": "Dolore laborum cillum",
						"link": { "url": "/", "label": "Contacta'ns" },
						"type": "secondary negative"
					},
					{
						"icon": "Officia velit elit",
						"link": {
							"url": "/comissions",
							"label": "Busca la teva comisssió"
						},
						"type": "primary negative"
					}
				]
			}
		});

	component_6 = new Component$7({
			props: {
				heading: "La màgia del Pi en acció!",
				subhead: "",
				icon_list: [],
				cards: [
					{
						"icon": "akar-icons:music",
						"link": {
							"url": "/curs-2023-24",
							"label": "Escolta-la!!"
						},
						"title": "Cançó del Pinyot (Joan-Pau Chaves)",
						"content": {
							"html": "<p>el nostre gegantó té una cançó i la balla a ritme de Joan-Pau Chaves</p>",
							"markdown": "el nostre gegantó té una cançó i la balla a ritme de Joan-Pau Chaves\n"
						}
					},
					{
						"icon": "akar-icons:video",
						"link": { "url": "/", "label": "Mira-te'l" },
						"title": "Lipdub de l’escola de l’any 2012",
						"content": {
							"html": "<p>Un homenatge a mestres, escola, pares, monitors i col.laboradors de l'escola.</p>",
							"markdown": "Un homenatge a mestres, escola, pares, monitors i col.laboradors de l'escola."
						}
					}
				]
			}
		});

	component_7 = new Component$8({});

	component_8 = new Component$9({
			props: {
				heading: "Bústia de suggeriments",
				subheading: "Whether you have questions, feedback, or just want to say hello, we're always ready to hear from you. Please fill out the contact form, and we'll do our best to respond within 24-48 hours.",
				social: [
					{
						"icon": "mdi:instagram",
						"link": { "url": "/", "label": "Instagram" }
					}
				],
				inputs: [
					{
						"type": "text",
						"label": "Name",
						"placeholder": "John Doe"
					},
					{
						"type": "email",
						"label": "Email",
						"placeholder": "johndoe@johndoe.com"
					},
					{
						"type": "",
						"label": "El teu missatge",
						"placeholder": "El teu missatge"
					}
				],
				submit_label: "Submit"
			}
		});

	component_9 = new Component$a({
			props: {
				footer_links: [
					{ "link": { "url": "/", "label": "Inici" } },
					{
						"link": {
							"url": "/qui-som",
							"label": "Qui som",
							"active": false
						}
					},
					{
						"link": {
							"url": "/comissions",
							"label": "Comissions",
							"active": false
						}
					},
					{
						"link": {
							"url": "/projectes",
							"label": "Projectes"
						}
					},
					{
						"link": {
							"url": "/curs-2023-24",
							"label": "Curs 2023/24"
						}
					},
					{
						"link": {
							"url": "/documents",
							"label": "Documents"
						}
					}
				]
			}
		});

	component_10 = new Component$b({
			props: {
				nav: [
					{
						"link": {
							"url": "#",
							"label": "Copyright 2023 AFA Escola Pi d'en Xandri"
						}
					}
				],
				social: [
					{
						"icon": "mdi:instagram",
						"link": { "url": "/", "label": "Instagram" }
					}
				]
			}
		});

	component_11 = new Component$c({});

	return {
		c() {
			create_component(component_0.$$.fragment);
			t0 = space();
			create_component(component_1.$$.fragment);
			t1 = space();
			create_component(component_2.$$.fragment);
			t2 = space();
			create_component(component_3.$$.fragment);
			t3 = space();
			create_component(component_4.$$.fragment);
			t4 = space();
			create_component(component_5.$$.fragment);
			t5 = space();
			create_component(component_6.$$.fragment);
			t6 = space();
			create_component(component_7.$$.fragment);
			t7 = space();
			create_component(component_8.$$.fragment);
			t8 = space();
			create_component(component_9.$$.fragment);
			t9 = space();
			create_component(component_10.$$.fragment);
			t10 = space();
			create_component(component_11.$$.fragment);
		},
		l(nodes) {
			claim_component(component_0.$$.fragment, nodes);
			t0 = claim_space(nodes);
			claim_component(component_1.$$.fragment, nodes);
			t1 = claim_space(nodes);
			claim_component(component_2.$$.fragment, nodes);
			t2 = claim_space(nodes);
			claim_component(component_3.$$.fragment, nodes);
			t3 = claim_space(nodes);
			claim_component(component_4.$$.fragment, nodes);
			t4 = claim_space(nodes);
			claim_component(component_5.$$.fragment, nodes);
			t5 = claim_space(nodes);
			claim_component(component_6.$$.fragment, nodes);
			t6 = claim_space(nodes);
			claim_component(component_7.$$.fragment, nodes);
			t7 = claim_space(nodes);
			claim_component(component_8.$$.fragment, nodes);
			t8 = claim_space(nodes);
			claim_component(component_9.$$.fragment, nodes);
			t9 = claim_space(nodes);
			claim_component(component_10.$$.fragment, nodes);
			t10 = claim_space(nodes);
			claim_component(component_11.$$.fragment, nodes);
		},
		m(target, anchor) {
			mount_component(component_0, target, anchor);
			insert_hydration(target, t0, anchor);
			mount_component(component_1, target, anchor);
			insert_hydration(target, t1, anchor);
			mount_component(component_2, target, anchor);
			insert_hydration(target, t2, anchor);
			mount_component(component_3, target, anchor);
			insert_hydration(target, t3, anchor);
			mount_component(component_4, target, anchor);
			insert_hydration(target, t4, anchor);
			mount_component(component_5, target, anchor);
			insert_hydration(target, t5, anchor);
			mount_component(component_6, target, anchor);
			insert_hydration(target, t6, anchor);
			mount_component(component_7, target, anchor);
			insert_hydration(target, t7, anchor);
			mount_component(component_8, target, anchor);
			insert_hydration(target, t8, anchor);
			mount_component(component_9, target, anchor);
			insert_hydration(target, t9, anchor);
			mount_component(component_10, target, anchor);
			insert_hydration(target, t10, anchor);
			mount_component(component_11, target, anchor);
			current = true;
		},
		p: noop,
		i(local) {
			if (current) return;
			transition_in(component_0.$$.fragment, local);
			transition_in(component_1.$$.fragment, local);
			transition_in(component_2.$$.fragment, local);
			transition_in(component_3.$$.fragment, local);
			transition_in(component_4.$$.fragment, local);
			transition_in(component_5.$$.fragment, local);
			transition_in(component_6.$$.fragment, local);
			transition_in(component_7.$$.fragment, local);
			transition_in(component_8.$$.fragment, local);
			transition_in(component_9.$$.fragment, local);
			transition_in(component_10.$$.fragment, local);
			transition_in(component_11.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(component_0.$$.fragment, local);
			transition_out(component_1.$$.fragment, local);
			transition_out(component_2.$$.fragment, local);
			transition_out(component_3.$$.fragment, local);
			transition_out(component_4.$$.fragment, local);
			transition_out(component_5.$$.fragment, local);
			transition_out(component_6.$$.fragment, local);
			transition_out(component_7.$$.fragment, local);
			transition_out(component_8.$$.fragment, local);
			transition_out(component_9.$$.fragment, local);
			transition_out(component_10.$$.fragment, local);
			transition_out(component_11.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			destroy_component(component_0, detaching);
			if (detaching) detach(t0);
			destroy_component(component_1, detaching);
			if (detaching) detach(t1);
			destroy_component(component_2, detaching);
			if (detaching) detach(t2);
			destroy_component(component_3, detaching);
			if (detaching) detach(t3);
			destroy_component(component_4, detaching);
			if (detaching) detach(t4);
			destroy_component(component_5, detaching);
			if (detaching) detach(t5);
			destroy_component(component_6, detaching);
			if (detaching) detach(t6);
			destroy_component(component_7, detaching);
			if (detaching) detach(t7);
			destroy_component(component_8, detaching);
			if (detaching) detach(t8);
			destroy_component(component_9, detaching);
			if (detaching) detach(t9);
			destroy_component(component_10, detaching);
			if (detaching) detach(t10);
			destroy_component(component_11, detaching);
		}
	};
}

class Component$d extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, null, create_fragment$c, safe_not_equal, {});
	}
}

export default Component$d;
