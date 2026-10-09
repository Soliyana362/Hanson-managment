/* One-time helper to obtain a Gmail API refresh token for sending mail.
 *
 * Prerequisites (Google Cloud Console, https://console.cloud.google.com):
 *   1. Create (or pick) a project.
 *   2. APIs & Services -> Library -> enable "Gmail API".
 *   3. APIs & Services -> OAuth consent screen: External, add your sending
 *      Gmail address under "Test users" (or publish the app).
 *   4. APIs & Services -> Credentials -> Create credentials ->
 *      OAuth client ID -> Application type "Desktop app". Copy the client ID
 *      and client secret.
 *
 * Run (PowerShell):
 *   $env:GMAIL_CLIENT_ID="...apps.googleusercontent.com"
 *   $env:GMAIL_CLIENT_SECRET="..."
 *   node scripts/gmail-refresh-token.js
 *
 * Open the printed URL, sign in as the sending account, grant access, then copy
 * the GMAIL_REFRESH_TOKEN it prints into your Render environment.
 */
const http = require('http');
const { URL } = require('url');

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
const port = Number(process.env.GMAIL_AUTH_PORT || 53682);
const redirectUri = `http://127.0.0.1:${port}`;
const scope = 'https://www.googleapis.com/auth/gmail.send';

if (!clientId || !clientSecret) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables first.');
  process.exit(1);
}

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope,
  access_type: 'offline',
  prompt: 'consent',
})}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`Authorization failed: ${error}`);
    console.error('Authorization failed:', error);
    server.close();
    return;
  }
  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Waiting for Google authorization...');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Done. You can close this tab and return to the terminal.');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      console.error('Token exchange failed:', data);
    } else {
      console.log('\nSuccess. Add this to your environment:\n');
      console.log(`GMAIL_REFRESH_TOKEN=${data.refresh_token}\n`);
    }
  } catch (err) {
    console.error('Token exchange error:', err.message);
  } finally {
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('\nOpen this URL in your browser and sign in as the sending Gmail account:\n');
  console.log(`${authUrl}\n`);
  console.log(`Waiting for the redirect on ${redirectUri} ...\n`);
});
