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

export function getBootstrap() {
  return apiRequest('/social/bootstrap');
}

export function runAction(action, payload = {}) {
  return apiRequest('/social/actions', {
    method: 'POST',
    body: { action, payload },
  });
}

export function createProfile(profile) {
  return apiRequest('/auth/profile', { method: 'POST', body: profile });
}

export async function uploadFile(file, purpose) {
  const request = await apiRequest('/storage/uploads/request-url', {
    method: 'POST',
    body: {
      name: file.name,
      size: file.size,
      contentType: file.type,
      purpose,
    },
  });
  let uploadResponse;
  try {
    uploadResponse = await fetch(request.uploadURL, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
  } catch {
    throw new ApiError('The file could not be uploaded. Please try again.');
  }
  if (!uploadResponse.ok) {
    throw new ApiError('The file could not be uploaded. Please try again.', uploadResponse.status);
  }
  return apiRequest('/storage/uploads/complete', {
    method: 'POST',
    body: { assetId: request.assetId },
  });
}
