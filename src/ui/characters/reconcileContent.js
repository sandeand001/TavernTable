// Keep native controls alive so recalculating the sheet preserves focus and Tab navigation.
export function reconcileContent(root, markup, preserveInput = null) {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = markup;
  const key = (node) =>
    node.nodeType === 1
      ? node.getAttribute('data-sheet-key') ||
        node.getAttribute('data-character-field') ||
        node.getAttribute('aria-label') ||
        (node.tagName === 'OPTION' ? node.value : '')
      : '';
  const compatible = (a, b) =>
    a.nodeType === b.nodeType &&
    (a.nodeType !== 1 || (a.tagName === b.tagName && key(a) === key(b)));
  const patchChildren = (parent, incoming) => {
    let cursor = parent.firstChild;
    for (const next of Array.from(incoming.childNodes)) {
      let node = cursor;
      if (!node || !compatible(node, next)) {
        node = key(next)
          ? Array.from(parent.childNodes).find((candidate) => compatible(candidate, next))
          : null;
        if (node) parent.insertBefore(node, cursor);
        else {
          node = next.cloneNode(true);
          parent.insertBefore(node, cursor);
        }
      }
      if (node.nodeType === 1) {
        for (const attribute of Array.from(node.attributes)) {
          if (!next.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
        }
        for (const attribute of Array.from(next.attributes)) {
          if (node.getAttribute(attribute.name) !== attribute.value) {
            node.setAttribute(attribute.name, attribute.value);
          }
        }
        // Child widgets own their controls and unfinished edits.
        if (!next.hasAttribute('data-sheet-island')) patchChildren(node, next);
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) {
          if (node !== preserveInput && node.value !== next.value) node.value = next.value;
          if (node.tagName === 'INPUT') node.checked = next.checked;
          node.disabled = next.disabled;
        }
      } else if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue;
      cursor = node.nextSibling;
    }
    while (cursor) {
      const next = cursor.nextSibling;
      parent.removeChild(cursor);
      cursor = next;
    }
  };
  patchChildren(root, template.content);
}
