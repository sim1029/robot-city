import type { ReactNode } from 'react'

const HTMX_CDN = 'https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js'
const HTMX_SRI = 'sha384-HGfztofotfshcF7+8n44JQL2oJmowVChPTg48S+jvZoztPfvwD79OC/LTtG6dMp+'

interface LayoutProps {
  title: string
  csrfToken: string
  currentPath?: string
  children: ReactNode
}

const NAV = [
  { href: '/admin', label: 'Home' },
  { href: '/admin/contacts', label: 'Contacts' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/vault', label: 'Vault' },
  { href: '/admin/actions', label: 'Actions' },
]

const HTMX_CSRF_BOOT = `
  document.addEventListener('htmx:configRequest', function (evt) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) evt.detail.headers['X-CSRF-Token'] = meta.content;
  });
`

const NAV_TOGGLE_SCRIPT = `
  (function() {
    var btn = document.querySelector('.nav-hamburger');
    var nav = document.querySelector('header nav');
    if (!btn || !nav) return;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = nav.classList.toggle('nav-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function(e) {
      if (!nav.classList.contains('nav-open')) return;
      if (!e.target.closest('header')) {
        nav.classList.remove('nav-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  })();
`

export function Layout({ title, csrfToken, currentPath, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} · robot-city`}</title>
        <meta name="csrf-token" content={csrfToken} />
        <link rel="stylesheet" href="/admin/static/styles.css" />
        <script src={HTMX_CDN} integrity={HTMX_SRI} crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: HTMX_CSRF_BOOT }} />
      </head>
      <body>
        <header>
          <div className="brand">
            <a href="/admin">robot-city</a>
          </div>
          <button className="nav-hamburger" aria-label="Menu" aria-expanded="false">
            <span />
            <span />
            <span />
          </button>
          <nav>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={currentPath === n.href ? 'active' : undefined}>
                {n.label}
              </a>
            ))}
            <button className="logout" hx-post="/auth/logout">
              Logout
            </button>
          </nav>
        </header>
        <main>{children}</main>
        <script dangerouslySetInnerHTML={{ __html: NAV_TOGGLE_SCRIPT }} />
      </body>
    </html>
  )
}
