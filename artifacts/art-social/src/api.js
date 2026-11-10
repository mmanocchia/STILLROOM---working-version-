const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const apiRoot = `${basePath}/api`;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
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
  } catch {
    throw new ApiError('Could not reach Stillroom. Check your connection and try again.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error || 'That request could not be completed.', response.status);
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
