import { Hono } from 'hono'
import { renderPage } from './render'

function LoginPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login · robot-city</title>
        <link rel="stylesheet" href="/admin/static/styles.css" />
      </head>
      <body className="login-page">
        <main className="login-card">
          <h1>robot-city</h1>
          <p>Sign in with the owner Discord account to continue.</p>
          <a className="btn-primary" href="/auth/discord/login">
            Continue with Discord
          </a>
        </main>
      </body>
    </html>
  )
}

export const loginRoutes = new Hono()

loginRoutes.get('/login', (c) => {
  return c.html(renderPage(<LoginPage />))
})
