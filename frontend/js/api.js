// Requests to the backend. Every error comes back as { szError }.

async function readJson(response) {
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw error; // cancelled while the body was arriving
    body = null;
  }
  if (!response.ok || !body) {
    const message = (body && body.szError)
      || (response.ok ? 'The server sent a response that isn\'t JSON' : `${response.status} ${response.statusText || 'Request failed'}`);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

function networkError() {
  const error = new Error('Could not reach the server. Check that the container is running and you are on Tailscale.');
  error.status = 0;
  return error;
}

export async function getHealth() {
  try {
    return await readJson(await fetch('api/health', { cache: 'no-store' }));
  } catch (error) {
    throw error.status === undefined ? networkError() : error;
  }
}

export async function convertFile(file, signal) {
  const form = new FormData();
  form.append('file', file, file.name);
  let response;
  try {
    response = await fetch('api/convert/file', { method: 'POST', body: form, signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw networkError();
  }
  return readJson(response);
}

export async function convertUrl(url, signal) {
  let response;
  try {
    response = await fetch('api/convert/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ szUrl: url }),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw networkError();
  }
  return readJson(response);
}
