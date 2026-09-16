/* Bookdose chat widget for an organization's own website.

     <script src="https://<bookdose host>/widget.js" data-org="<organization code>" async></script>

   Adds a floating chat button that opens the organization's chat (/chat/<code>/embed) in a panel. Plain ES2017, no
   framework, and no <style> element or style attribute: every style is set through element.style, which a host page's
   Content-Security-Policy allows. The chat inside the iframe tells this script, by postMessage, when it is ready (with
   the button's position, colour and title) and how many replies are unread; messages are only accepted from the
   Bookdose origin and the iframe itself, and the iframe only answers websites the organization allowed. A website
   that is not allowed cannot frame the chat, so the button never appears there. */
(function () {
  'use strict';

  const script =
    document.currentScript || document.querySelector('script[data-org][src*="widget.js"]');
  if (!script || !script.src) return;
  const slug = String(script.getAttribute('data-org') || '').trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return;
  const registry = (window.__bookdoseChat = window.__bookdoseChat || {});
  if (registry[slug]) return;
  registry[slug] = true;

  const base = new URL(script.src, window.location.href).origin;
  const chatUrl = base + '/chat/' + slug;
  const THEMES = { purple: '#5835b3', blue: '#1f5f8b', green: '#2f7556', orange: '#b4540a', charcoal: '#26292d' };
  const Z = '2147483000';
  const SVG = 'http://www.w3.org/2000/svg';
  const config = { position: 'right', theme: 'purple', title: '' };
  const phone = window.matchMedia('(max-width: 600px)');
  let ready = false;
  let open = false;
  let unread = 0;
  let helloTimer = 0;

  function set(element, styles) {
    Object.keys(styles).forEach(function (key) {
      element.style[key] = styles[key];
    });
    return element;
  }

  function icon(paths, size) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  const color = function () {
    return THEMES[config.theme] || THEMES.purple;
  };
  const label = function () {
    const name = config.title || 'แชทกับทีมงาน';
    return unread > 0 ? name + ' (มีข้อความใหม่ ' + unread + ')' : name;
  };

  /* The floating button */
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'bookdose-chat-' + slug);
  set(button, {
    position: 'fixed',
    bottom: '20px',
    width: '60px',
    height: '60px',
    padding: '0',
    border: '0',
    borderRadius: '50%',
    color: '#fff',
    cursor: 'pointer',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.28)',
    zIndex: Z,
  });
  button.appendChild(icon(['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'], 28));
  const badge = document.createElement('span');
  badge.setAttribute('aria-hidden', 'true');
  set(badge, {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    minWidth: '22px',
    height: '22px',
    padding: '0 6px',
    borderRadius: '11px',
    border: '2px solid #fff',
    background: '#d93025',
    color: '#fff',
    font: '700 12px/18px system-ui, sans-serif',
    textAlign: 'center',
    boxSizing: 'border-box',
    display: 'none',
  });
  button.appendChild(badge);

  /* The panel: a title bar (title, open in a new window, close) and the chat */
  const panel = document.createElement('div');
  panel.id = 'bookdose-chat-' + slug;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  set(panel, {
    position: 'fixed',
    display: 'none',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#fff',
    boxShadow: '0 16px 48px rgba(15, 23, 42, 0.3)',
    zIndex: Z,
  });
  const bar = document.createElement('div');
  set(bar, {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minHeight: '52px',
    padding: '0 6px 0 16px',
    color: '#fff',
    font: '600 16px/1.3 system-ui, sans-serif',
    boxSizing: 'border-box',
    flex: 'none',
  });
  const title = document.createElement('span');
  set(title, { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  const barButton = function (element, text) {
    element.setAttribute('aria-label', text);
    element.title = text;
    return set(element, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '40px',
      height: '40px',
      padding: '0',
      border: '0',
      borderRadius: '8px',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
      textDecoration: 'none',
    });
  };
  const newWindow = barButton(document.createElement('a'), 'เปิดในหน้าต่างใหม่');
  newWindow.href = chatUrl;
  newWindow.target = '_blank';
  newWindow.rel = 'noopener';
  newWindow.appendChild(icon(['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'], 20));
  const close = barButton(document.createElement('button'), 'ปิดแชท');
  close.type = 'button';
  close.appendChild(icon(['M18 6 6 18', 'M6 6l12 12'], 22));
  bar.appendChild(title);
  bar.appendChild(newWindow);
  bar.appendChild(close);

  const frame = document.createElement('iframe');
  frame.src = chatUrl + '/embed';
  frame.title = 'แชทกับทีมงาน';
  frame.setAttribute('allow', 'clipboard-write');
  set(frame, { flex: '1', width: '100%', minHeight: '0', border: '0', display: 'block', background: '#fff' });
  panel.appendChild(bar);
  panel.appendChild(frame);

  function send(message) {
    if (!frame.contentWindow) return;
    message.type = 'bd-chat';
    frame.contentWindow.postMessage(message, base);
  }

  function layout() {
    const side = config.position === 'left' ? 'left' : 'right';
    const other = side === 'left' ? 'right' : 'left';
    set(button, { background: color() });
    button.style[side] = '20px';
    button.style[other] = 'auto';
    bar.style.background = color();
    title.textContent = config.title || 'แชทกับทีมงาน';
    panel.setAttribute('aria-label', config.title || 'แชทกับทีมงาน');
    button.setAttribute('aria-label', label());
    button.title = config.title || 'แชทกับทีมงาน';
    if (phone.matches) {
      // A phone: the chat takes the whole screen, and the button steps aside while it is open.
      set(panel, { top: '0', left: '0', right: '0', bottom: '0', width: '100%', height: '100%', borderRadius: '0' });
      button.style.display = ready && !open ? 'inline-flex' : 'none';
    } else {
      set(panel, { top: 'auto', bottom: '92px', width: '380px', height: 'min(640px, calc(100vh - 120px))', borderRadius: '16px' });
      panel.style[side] = '20px';
      panel.style[other] = 'auto';
      button.style.display = ready ? 'inline-flex' : 'none';
    }
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.style.display = unread > 0 && !open ? 'block' : 'none';
  }

  function setOpen(next) {
    if (open === next) return;
    open = next;
    panel.style.display = open ? 'flex' : 'none';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    layout();
    send({ open: open });
    if (open) frame.focus();
    else if (button.style.display !== 'none') button.focus();
  }

  button.addEventListener('click', function () {
    setOpen(!open);
  });
  close.addEventListener('click', function () {
    setOpen(false);
  });
  document.addEventListener('keydown', function (event) {
    if (open && event.key === 'Escape') setOpen(false);
  });
  if (phone.addEventListener) phone.addEventListener('change', layout);

  window.addEventListener('message', function (event) {
    if (event.origin !== base || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== 'bd-chat') return;
    if (data.ready) {
      ready = true;
      clearInterval(helloTimer);
      if (data.position === 'left' || data.position === 'right') config.position = data.position;
      if (typeof data.theme === 'string' && THEMES[data.theme]) config.theme = data.theme;
      if (typeof data.title === 'string') config.title = data.title.slice(0, 80);
    }
    if (typeof data.unread === 'number' && data.unread >= 0) unread = Math.floor(data.unread);
    if (data.close) setOpen(false);
    layout();
  });

  // Say hello until the chat answers (it may still be loading); a website that may not frame it never answers.
  frame.addEventListener('load', function () {
    let tries = 0;
    clearInterval(helloTimer);
    send({ hello: true, open: open });
    helloTimer = setInterval(function () {
      tries += 1;
      if (ready || tries > 30) clearInterval(helloTimer);
      else send({ hello: true, open: open });
    }, 1000);
  });

  function start() {
    layout();
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }

  // The widget settings first (when this server lets the website read them): nothing is loaded while it is off.
  fetch(base + '/api/public/' + slug + '/widget', { credentials: 'omit' })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(
      function (widget) {
        if (widget && (!widget.enabled || widget.guest_chat === false)) return;
        if (widget) {
          if (widget.position === 'left') config.position = 'left';
          if (THEMES[widget.theme]) config.theme = widget.theme;
          if (typeof widget.title === 'string') config.title = widget.title;
        }
        whenBodyReady();
      },
      function () {
        // Not readable from this website (no CORS): the chat itself says whether it is on.
        whenBodyReady();
      },
    );

  function whenBodyReady() {
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }
})();
