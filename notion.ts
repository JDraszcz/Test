export type NotionCoursePage = {
  parent: {
    type: 'database_id';
    database_id: string;
  };
  properties: {
    Name: { title: Array<{ text: { content: string } }> };
    Matiere: { rich_text: Array<{ text: { content: string } }> };
    Jour: { rich_text: Array<{ text: { content: string } }> };
    Horaire: { rich_text: Array<{ text: { content: string } }> };
    Tags: { multi_select: Array<{ name: string }> };
  };
};

export type ExportableCourse = {
  day: string;
  subject: string;
  title: string;
  startTime: string;
  endTime: string;
  tags: string[];
};

const notionApiUrl =
  process.env.EXPO_PUBLIC_NOTION_API_URL ??
  (typeof window !== 'undefined' && window.location.hostname
    ? `http://${window.location.hostname}:8787`
    : 'http://localhost:8787');
const NOTION_DATABASE_ID_PLACEHOLDER = 'NOTION_DATABASE_ID';

export const getNotionAuthorizationUrl = () => {
  return `${notionApiUrl}/api/notion/oauth/start`;
};

export const getNotionConfiguration = async () => {
  const response = await fetch(`${notionApiUrl}/api/notion/config`);
  if (!response.ok) return false;
  const configuration = await response.json() as { configured?: boolean };
  return configuration.configured === true;
};

export const buildNotionExportPayload = (events: ExportableCourse[]): NotionCoursePage[] =>
  events.map((event) => ({
    parent: {
      type: 'database_id',
      database_id: NOTION_DATABASE_ID_PLACEHOLDER,
    },
    properties: {
      Name: { title: [{ text: { content: event.title } }] },
      Matiere: { rich_text: [{ text: { content: event.subject } }] },
      Jour: { rich_text: [{ text: { content: event.day } }] },
      Horaire: { rich_text: [{ text: { content: `${event.startTime} - ${event.endTime}` } }] },
      Tags: { multi_select: event.tags.map((tag) => ({ name: tag })) },
    },
  }));

export const getNotionSession = async () => {
  const response = await fetch(`${notionApiUrl}/api/notion/session`, { credentials: 'include' });
  if (!response.ok) {
    return false;
  }

  const session = await response.json() as { connected?: boolean };
  return session.connected === true;
};

export const exportEventsToNotion = async (events: ExportableCourse[]) => {
  const response = await fetch(`${notionApiUrl}/api/notion/export`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Export Notion impossible.' }));
    throw new Error(error.error ?? 'Export Notion impossible.');
  }

  return response.json() as Promise<{ exported: number }>;
};
