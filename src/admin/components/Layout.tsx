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
      </body>
    </html>
  )
}
