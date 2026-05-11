import { Hono } from 'hono'

export const loginRoutes = new Hono()

loginRoutes.get('/login', (c) => {
  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login · robot-city</title>
<link rel="stylesheet" href="/admin/static/styles.css">
</head>
<body class="login-page">
<main class="login-card">
  <h1>robot-city</h1>
  <p>Sign in with the owner Discord account to continue.</p>
  <a class="btn-primary" href="/auth/discord/login">Continue with Discord</a>
</main>
</body>
</html>`)
})
