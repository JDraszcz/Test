import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const loadDotEnv = async () => {
  try {
    const content = await readFile(new URL('../.env', import.meta.url), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

await loadDotEnv();

const port = Number(process.env.PORT ?? 8787);
const notionClientId = process.env.NOTION_CLIENT_ID;
const notionClientSecret = process.env.NOTION_CLIENT_SECRET;
const notionRedirectUri = process.env.NOTION_REDIRECT_URI;
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:8081';
const notionAppCallbackUri = process.env.NOTION_APP_CALLBACK_URI ?? `${appOrigin}/?notion_connected=true`;
const notionDatabaseId = process.env.NOTION_DATABASE_ID;
const sessions = new Map();
const oauthStates = new Map();

const getAllowedOrigin = (request) => {
  const origin = request.headers.origin;
  if (!origin) return appOrigin;
  if (origin === appOrigin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return appOrigin;
};

const sendJson = (request, response, statusCode, payload, headers = {}) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': getAllowedOrigin(request),
    'Vary': 'Origin',
    ...headers,
  });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const parseCookies = (request) =>
  Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((cookie) => cookie.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join('='))]),
  );

const createNotionPage = (event) => ({
  parent: { database_id: notionDatabaseId },
  properties: {
    Name: { title: [{ text: { content: String(event.title ?? '') } }] },
    Matiere: { rich_text: [{ text: { content: event.subject || 'Sans matiere' } }] },
    Jour: { rich_text: [{ text: { content: String(event.day ?? '') } }] },
    Horaire: { rich_text: [{ text: { content: `${event.startTime ?? ''} - ${event.endTime ?? ''}` } }] },
    Tags: { multi_select: Array.isArray(event.tags) ? event.tags.map((tag) => ({ name: String(tag) })) : [] },
  },
});

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      Vary: 'Origin',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/notion/oauth/start') {
    if (!notionClientId || !notionRedirectUri) {
      sendJson(request, response, 500, { error: 'Configurez NOTION_CLIENT_ID et NOTION_REDIRECT_URI dans .env.' });
      return;
    }

    const state = randomBytes(24).toString('hex');
    const origin = getAllowedOrigin(request);
    oauthStates.set(state, {
      createdAt: Date.now(),
      appCallbackUri: `${origin}/?notion_connected=true`,
    });
    const authorizeUrl = new URL('https://api.notion.com/v1/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', notionClientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('owner', 'user');
    authorizeUrl.searchParams.set('redirect_uri', notionRedirectUri);
    authorizeUrl.searchParams.set('state', state);
    response.writeHead(302, { Location: authorizeUrl.toString() });
    response.end();
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/notion/config') {
    sendJson(request, response, 200, {
      configured: Boolean(notionClientId && notionClientSecret && notionRedirectUri && notionDatabaseId),
    });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/notion/oauth/callback') {
    const state = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');
    const oauthState = state ? oauthStates.get(state) : undefined;
    if (!state || !code || !oauthState || Date.now() - oauthState.createdAt > 10 * 60 * 1000) {
      sendJson(request, response, 400, { error: 'Etat OAuth invalide ou expire.' });
      return;
    }
    oauthStates.delete(state);

    if (!notionClientId || !notionClientSecret || !notionRedirectUri) {
      sendJson(request, response, 500, { error: 'Configuration OAuth Notion incomplete.' });
      return;
    }

    const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${notionClientId}:${notionClientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: notionRedirectUri }),
    });
    if (!tokenResponse.ok) {
      sendJson(request, response, 502, { error: 'Notion a refuse l echange OAuth.' });
      return;
    }

    const token = await tokenResponse.json();
    const sessionId = randomBytes(32).toString('hex');
    sessions.set(sessionId, { accessToken: token.access_token, createdAt: Date.now() });
    response.writeHead(302, {
      'Set-Cookie': `notion_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
      Location: oauthState.appCallbackUri || notionAppCallbackUri,
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/notion/session') {
    sendJson(request, response, 200, { connected: Boolean(sessions.get(parseCookies(request).notion_session)) });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/notion/export') {
    const session = sessions.get(parseCookies(request).notion_session);
    if (!session) {
      sendJson(request, response, 401, { error: 'Connexion Notion requise.' });
      return;
    }
    if (!notionDatabaseId) {
      sendJson(request, response, 500, { error: 'Configurez NOTION_DATABASE_ID dans .env.' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(request, response, 400, { error: 'Le corps de la requete est invalide.' });
      return;
    }
    if (!Array.isArray(body.events)) {
      sendJson(request, response, 400, { error: 'La liste des cours est invalide.' });
      return;
    }

    let exported = 0;
    for (const event of body.events) {
      const notionResponse = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(createNotionPage(event)),
      });
      if (!notionResponse.ok) {
        sendJson(request, response, 502, { error: `Notion a refuse le cours "${event.title}".` });
        return;
      }
      exported += 1;
    }

    sendJson(request, response, 200, { exported });
    return;
  }

  sendJson(request, response, 404, { error: 'Route introuvable.' });
});

server.listen(port, () => {
  console.log(`Notion backend listening on http://localhost:${port}`);
});
