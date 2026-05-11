const HTMX_CDN = 'https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js'
const HTMX_SRI = 'sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+'

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface LayoutOpts {
  title: string
  csrfToken: string
  body: string
  currentPath?: string
}

export function layout(opts: LayoutOpts): string {
  const nav = [
    { href: '/admin', label: 'Home' },
    { href: '/admin/settings', label: 'Settings' },
    { href: '/admin/vault', label: 'Vault' },
    { href: '/admin/actions', label: 'Actions' },
  ]
  const navHtml = nav
    .map((n) => {
      const active = opts.currentPath === n.href ? ' class="active"' : ''
      return `<a href="${n.href}"${active}>${n.label}</a>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · robot-city</title>
<meta name="csrf-token" content="${esc(opts.csrfToken)}">
<link rel="stylesheet" href="/admin/static/styles.css">
<script src="${HTMX_CDN}" integrity="${HTMX_SRI}" crossorigin="anonymous"></script>
<script>
  document.addEventListener('htmx:configRequest', function (evt) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) evt.detail.headers['X-CSRF-Token'] = meta.content;
  });
</script>
</head>
<body>
<header>
  <div class="brand"><a href="/admin">robot-city</a></div>
  <nav>
    ${navHtml}
    <button class="logout" hx-post="/auth/logout">Logout</button>
  </nav>
</header>
<main>
${opts.body}
</main>
</body>
</html>`
}
