// Minimal runtime for viewing the prototype outside the design canvas.
// It supports only what prototype/Main.dc.html uses: {{ dotted.path }} holes,
// <sc-if>, <sc-for>, on* event attributes and a DCLogic class with setState.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  const BOOLEAN_ATTRIBUTES = ['disabled', 'checked', 'readonly'];

  class DCLogic {
    constructor(props, onChange) {
      this.props = props || {};
      this.state = {};
      this._onChange = onChange;
    }

    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, next);
      this._onChange();
    }

    forceUpdate() {
      this._onChange();
    }
  }

  function lookup(expression, scope) {
    const text = expression.trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    const parts = text.split('.');
    let value;
    for (let frame = scope; frame; frame = frame.__parent) {
      if (Object.prototype.hasOwnProperty.call(frame, parts[0])) {
        value = frame[parts[0]];
        break;
      }
    }
    for (let i = 1; i < parts.length; i++) {
      if (value == null) return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  function interpolate(text, scope) {
    return text.replace(HOLE, (match, expression) => {
      const value = lookup(expression, scope);
      return value == null ? '' : String(value);
    });
  }

  function attributeValue(text, scope) {
    const whole = text.match(WHOLE);
    return whole ? lookup(whole[1], scope) : interpolate(text, scope);
  }

  function renderChildren(source, parent, scope) {
    source.childNodes.forEach((child) => renderNode(child, parent, scope));
  }

  function renderNode(node, parent, scope) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(interpolate(node.nodeValue, scope)));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    if (tag === 'helmet') return;
    if (tag === 'sc-if') {
      if (attributeValue(node.getAttribute('value') || '', scope)) renderChildren(node, parent, scope);
      return;
    }
    if (tag === 'sc-for') {
      const list = attributeValue(node.getAttribute('list') || '', scope) || [];
      const name = node.getAttribute('as') || 'item';
      list.forEach((item, index) => {
        const frame = { __parent: scope, $index: index };
        frame[name] = item;
        renderChildren(node, parent, frame);
      });
      return;
    }
    const element = node.namespaceURI === SVG_NS
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name;
      if (name.startsWith('hint-')) return;
      const value = attributeValue(attribute.value, scope);
      if (name.startsWith('on')) {
        if (typeof value !== 'function') return;
        let event = name.slice(2);
        const isTextInput = tag === 'input' && (node.getAttribute('type') || 'text') !== 'checkbox';
        if (event === 'change' && isTextInput) event = 'input';
        element.addEventListener(event, value);
        return;
      }
      if (BOOLEAN_ATTRIBUTES.indexOf(name) >= 0) {
        if (value === true || value === 'true') {
          element.setAttribute(name, '');
          if (name === 'checked') element.checked = true;
        }
        return;
      }
      if (value === false || value == null) return;
      if (name === 'value' && tag === 'input') {
        element.value = String(value);
      }
      element.setAttribute(name, String(value));
    });
    renderChildren(node, element, scope);
    parent.appendChild(element);
  }

  function elementPath(element, root) {
    const path = [];
    for (let node = element; node && node !== root; node = node.parentNode) {
      path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
    }
    return path.join('/');
  }

  function elementAt(root, path) {
    let node = root;
    for (const index of path.split('/')) {
      if (!node || index === '') return null;
      node = node.childNodes[Number(index)];
    }
    return node;
  }

  function mount(root, template, Component, props) {
    let pending = false;
    const instance = new Component(props, schedule);

    function render() {
      pending = false;
      const active = document.activeElement;
      const focusId = active && root.contains(active) ? active.id : '';
      const selection = focusId && typeof active.selectionStart === 'number'
        ? [active.selectionStart, active.selectionEnd]
        : null;
      const scrolls = [];
      root.querySelectorAll('*').forEach((element) => {
        if (element.scrollTop > 0) scrolls.push([elementPath(element, root), element.scrollTop]);
      });

      const fragment = document.createDocumentFragment();
      renderChildren(template.content, fragment, instance.renderVals());
      root.replaceChildren(fragment);

      scrolls.forEach(([path, top]) => {
        const element = elementAt(root, path);
        if (element) element.scrollTop = top;
      });
      if (focusId) {
        const next = document.getElementById(focusId);
        if (next) {
          next.focus();
          if (selection && typeof next.setSelectionRange === 'function') next.setSelectionRange(selection[0], selection[1]);
        }
      }
    }

    function schedule() {
      if (pending) return;
      pending = true;
      Promise.resolve().then(render);
    }

    render();
    return instance;
  }

  window.DCStandalone = { DCLogic: DCLogic, mount: mount };
})();
