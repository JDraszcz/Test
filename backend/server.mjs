import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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
const eventsFile = new URL('./events.json', import.meta.url);

const readEvents = async () => {
  try {
    const events = JSON.parse(await readFile(eventsFile, 'utf8'));
    return Array.isArray(events) ? events : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const writeEvents = (events) => writeFile(eventsFile, `${JSON.stringify(events, null, 2)}\n`, 'utf8');

const validateEvent = (event) => {
  if (!event || typeof event !== 'object') return 'Le cours est invalide.';
  if (!String(event.id ?? '').trim() || !String(event.title ?? '').trim()) return 'Identifiant et nom du cours requis.';
  if (!String(event.day ?? '').trim()) return 'Jour du cours requis.';
  if (!/^\d{2}:[03]0$/.test(String(event.startTime ?? '')) || !/^\d{2}:[03]0$/.test(String(event.endTime ?? ''))) return 'Les horaires doivent être des tranches de 30 minutes.';
  if (!Array.isArray(event.tags) || event.tags.some((tag) => typeof tag !== 'string')) return 'Les catégories sont invalides.';
  return null;
};

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
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      Vary: 'Origin',
    });
    response.end();
    return;
  }

  if (requestUrl.pathname === '/api/events') {
    let events;
    try {
      events = await readEvents();
    } catch {
      sendJson(request, response, 500, { error: 'Lecture des cours impossible.' });
      return;
    }
    if (request.method === 'GET') {
      sendJson(request, response, 200, { events });
      return;
    }
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(request, response, 400, { error: 'Le corps de la requête est invalide.' });
      return;
    }
    if (request.method === 'POST') {
      const error = validateEvent(body);
      if (error) {
        sendJson(request, response, 400, { error });
        return;
      }
      if (events.some((event) => event.id === body.id)) {
        sendJson(request, response, 409, { error: 'Ce cours existe déjà.' });
        return;
      }
      await writeEvents([...events, body]);
      sendJson(request, response, 201, { event: body });
      return;
    }
    sendJson(request, response, 405, { error: 'Méthode non autorisée sur cette route.' });
    return;
  }

  const eventMatch = requestUrl.pathname.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    const eventId = decodeURIComponent(eventMatch[1]);
    const events = await readEvents();
    const index = events.findIndex((event) => event.id === eventId);
    if (index < 0) {
      sendJson(request, response, 404, { error: 'Cours introuvable.' });
      return;
    }
    if (request.method === 'DELETE') {
      events.splice(index, 1);
      await writeEvents(events);
      sendJson(request, response, 200, { deleted: eventId });
      return;
    }
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      sendJson(request, response, 400, { error: 'Le corps de la requête est invalide.' });
      return;
    }
    const updated = { ...events[index], ...body, id: eventId };
    const error = validateEvent(updated);
    if (error) {
      sendJson(request, response, 400, { error });
      return;
    }
    events[index] = updated;
    await writeEvents(events);
    sendJson(request, response, 200, { event: updated });
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
