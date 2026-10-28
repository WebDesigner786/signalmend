export interface DashboardSession {
  token: string;
  workspaceId: string;
}

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiBaseUrl
  ? `${configuredApiBaseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/i, "")}/api/v1`
  : "/api/v1";

function getApiPath(path: string): string {
  const endpoint = path.startsWith("/api/v1/")
    ? path.slice("/api/v1".length)
    : path.startsWith("/")
      ? path
      : `/${path}`;
  return `${API_BASE_URL}${endpoint}`;
}

export async function dashboardFetch<T>(
  path: string,
  session: DashboardSession,
  options: RequestInit = {},
): Promise<T> {
  const url = new URL(getApiPath(path), window.location.origin);
  if (session.workspaceId) {
    url.searchParams.set("workspace_id", session.workspaceId);
  }
  const requestUrl = API_BASE_URL.startsWith("/")
    ? `${url.pathname}${url.search}`
    : url.toString();

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new DashboardApiError(
      error instanceof Error
        ? `Cannot reach the SignalMend API: ${error.message}`
        : "Cannot reach the SignalMend API",
      0,
    );
  }

  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof responseBody === "object" &&
      responseBody !== null &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
        ? responseBody.error
        : `The API returned HTTP ${response.status}`;
    throw new DashboardApiError(message, response.status);
  }

  return responseBody as T;
}

export function getDashboardApiBaseUrl(): string {
  return API_BASE_URL;
}
