import { DEVIN_API_BASE_URL } from './config.js';

const BASE_URL = DEVIN_API_BASE_URL;

async function request(method, path, body = null) {
  const headers = {
    'Authorization': `Bearer ${process.env.DEVIN_API_KEY}`,
  };

  const options = { method, headers };

  if (body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, options);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Devin API ${method} ${path} failed (${res.status}): ${errText}`);
  }

  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Create a new Devin session.
 * Returns { session_id, url, is_new_session }
 */
export async function createSession(prompt) {
  return request('POST', '/sessions', { prompt });
}

/**
 * Get session details including status, messages, and PR info.
 * Returns { session_id, status, status_enum, messages, pull_request, title, ... }
 */
export async function getSession(sessionId) {
  return request('GET', `/sessions/${sessionId}`);
}

/**
 * Send a message to an existing session.
 * Returns { detail }
 */
export async function sendMessage(sessionId, message) {
  return request('POST', `/sessions/${sessionId}/message`, { message });
}

/**
 * Terminate a session. Cannot be resumed after this.
 * Returns { detail }
 */
export async function terminateSession(sessionId) {
  return request('DELETE', `/sessions/${sessionId}`);
}

/**
 * Upload a file attachment. Returns the URL to reference in prompts.
 * Must be included as ATTACHMENT:"{url}" on its own line.
 */
export async function uploadAttachment(filename, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);

  const res = await fetch(`${BASE_URL}/attachments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEVIN_API_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Devin API attachment upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (typeof data === 'string') return data;
  if (data && typeof data.url === 'string') return data.url;
  throw new Error(`Unexpected attachment upload response: ${JSON.stringify(data)}`);
}
