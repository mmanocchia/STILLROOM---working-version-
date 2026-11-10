const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const apiRoot = `${basePath}/api`;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function httpErrorMessage(status) {
  if (status >= 500) return `Stillroom’s server could not complete this request (HTTP ${status}). Please try again.`;
  if (status === 401) return 'Please sign in again to continue (HTTP 401).';
  if (status === 403) return 'You do not have permission to complete this request (HTTP 403).';
  if (status === 404) return 'The requested Stillroom resource was not found (HTTP 404).';
  if (status === 429) return 'Too many requests. Please wait a moment and try again (HTTP 429).';
  return `That request could not be completed (HTTP ${status}). Please try again.`;
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const request = { ...options, credentials: 'include', headers };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    request.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(`${apiRoot}${path}`, request);
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApiError('The request was cancelled. Please try again.');
    throw new ApiError('No response was received from Stillroom. The connection may have been interrupted. Please try again.');
  }
  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      // A proxy can return an HTML error page. Preserve its HTTP status instead
      // of treating it as a network failure or accepting null as valid content.
      throw new ApiError(response.ok
        ? 'Stillroom returned an unreadable response. Please try again.'
        : httpErrorMessage(response.status), response.status);
    }
  }
  if (!response.ok) {
    throw new ApiError(typeof data?.error === 'string' && data.error.trim()
      ? data.error : httpErrorMessage(response.status), response.status);
  }
  if (response.status !== 204 && (!data || typeof data !== 'object')) {
    throw new ApiError('Stillroom returned an unreadable response. Please try again.', response.status);
  }
  return data;
}

export function contentQuery(selection = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(selection)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return query.size ? `?${query}` : '';
}

export function getBootstrap(selection = {}) {
  return apiRequest(`/social/bootstrap${contentQuery(selection)}`);
}
export function getComments(postId, cursor) {
  return apiRequest(`/social/comments${contentQuery({ postId, cursor })}`);
}
export function getShelves({ ownerId, postId, page = 0 } = {}) {
  return apiRequest(`/social/shelves${contentQuery({ ownerId, postId, page })}`);
}

export function runAction(action, payload = {}, selection = {}) {
  return apiRequest(`/social/actions${contentQuery(selection)}`, {
    method: 'POST',
    body: { action, payload },
  });
}

export function createProfile(profile) {
  return apiRequest('/auth/profile', { method: 'POST', body: profile });
}

export async function uploadFile(file, purpose, onProgress = () => {}) {
  const request = await apiRequest('/storage/uploads/request-url', {
    method: 'POST',
    body: {
      name: file.name,
      size: file.size,
      contentType: file.type,
      purpose,
    },
  });
  onProgress(0);
  await new Promise((resolve, reject) => {
    const upload = new XMLHttpRequest();
    upload.open('PUT', request.uploadURL);
    upload.setRequestHeader('Content-Type', file.type);
    upload.timeout = 5 * 60 * 1000;
    upload.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    upload.onload = () => upload.status >= 200 && upload.status < 300
      ? resolve()
      : reject(new ApiError('The file could not be uploaded. Please try again.', upload.status));
    upload.onerror = () => reject(new ApiError('The file could not be uploaded. Please try again.'));
    upload.ontimeout = () => reject(new ApiError('The upload timed out. Please try again.'));
    upload.onabort = () => reject(new ApiError('The upload was cancelled.'));
    upload.send(file);
  });
  onProgress(100);
  return apiRequest('/storage/uploads/complete', {
    method: 'POST',
    body: { assetId: request.assetId },
  });
}
