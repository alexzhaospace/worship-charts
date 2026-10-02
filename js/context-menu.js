// ============================================================
// context-menu.js — a small reusable right-click menu
// ============================================================
//
// Exposes `ContextMenu` with a single `show()` function:
//
//   ContextMenu.show(x, y, [
//     { icon: 'fa-pencil', label: 'Edit Song', action: () => {...} },
//     { divider: true },
//     { icon: 'fa-trash', label: 'Delete', action: () => {...}, danger: true }
//   ])
//
// The menu attaches itself to the document, dismisses on:
//   - click anywhere outside
//   - Escape key
//   - scroll
//   - resize
// ============================================================

window.ContextMenu = (function () {
  'use strict';

  let currentMenu = null;

  // ------------------------------------------------------------
  // DISMISS
  // ------------------------------------------------------------
  function dismiss() {
    if (!currentMenu) return;
    currentMenu.remove();
    currentMenu = null;
    document.removeEventListener('click', handleOutsideClick, true);
    document.removeEventListener('contextmenu', handleOutsideClick, true);
    document.removeEventListener('keydown', handleEscape, true);
    window.removeEventListener('scroll', dismiss, true);
    window.removeEventListener('resize', dismiss, true);
  }

  function handleOutsideClick(e) {
    if (!currentMenu) return;
    if (!currentMenu.contains(e.target)) {
      dismiss();
    }
  }

  function handleEscape(e) {
    if (e.key === 'Escape') dismiss();
  }

  // ------------------------------------------------------------
  // SHOW
  // ------------------------------------------------------------
  function show(x, y, items) {
    dismiss();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');

    items.forEach(item => {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        menu.appendChild(div);
        return;
      }

      const el = document.createElement('div');
      el.className = 'context-menu-item' + (item.danger ? ' danger' : '');
      el.setAttribute('role', 'menuitem');
      el.tabIndex = 0;

      if (item.icon) {
        const icon = document.createElement('i');
        icon.className = 'fas ' + item.icon;
        el.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = item.label;
      el.appendChild(label);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
        if (typeof item.action === 'function') {
          // Defer so the menu is fully gone before the action runs
          setTimeout(item.action, 0);
        }
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });

      menu.appendChild(el);
    });

    // Append first so we can measure
    document.body.appendChild(menu);

    // Position — keep within viewport
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = vw - rect.width - 8;
    if (top + rect.height > vh - 8) top = vh - rect.height - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    currentMenu = menu;

    // Attach dismissal handlers (deferred to avoid immediately catching the current event)
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick, true);
      document.addEventListener('contextmenu', handleOutsideClick, true);
      document.addEventListener('keydown', handleEscape, true);
      window.addEventListener('scroll', dismiss, true);
      window.addEventListener('resize', dismiss, true);
    }, 0);

    return menu;
  }

  return {
    show,
    dismiss,
    isOpen: () => !!currentMenu
  };
})();