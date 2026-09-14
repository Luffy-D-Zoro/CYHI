// Single place the backend URL is configured. Set VITE_API_BASE_URL in
// frontend/.env (see .env.example) for anything other than local dev —
// e.g. the deployed Railway backend URL in production.
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

async function parseJsonSafely(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Thin fetch wrapper: builds the full URL from API_BASE_URL, always sends/
// expects JSON, and throws an Error with the backend's own message (from
// ApiError's { error, details } shape) instead of a generic "Bad Request".
export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await parseJsonSafely(res);

  if (!res.ok) {
    const message =
      (data && Array.isArray(data.details) && data.details.join(", ")) ||
      (data && data.error) ||
      `Request failed with status ${res.status}.`;
    throw new Error(message);
  }

  return data;
}
