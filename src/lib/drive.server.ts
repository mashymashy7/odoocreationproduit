// Helpers Google Drive (serveur uniquement).
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export type DriveFile = { id: string; name: string; mimeType: string };

export function googleCredentials() {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("Les identifiants Google ne sont pas configurés.");
  }
  return { clientId, clientSecret };
}

export function driveRedirectUri(origin: string) {
  return `${origin.replace(/\/+$/, "")}/api/public/google/drive-callback`;
}

export function buildAuthUrl(origin: string, state: string) {
  const { clientId } = googleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: driveRedirectUri(origin),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: DRIVE_SCOPES,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error_description?: string;
  error?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google a refusé la connexion.");
  }
  return json;
}

export async function exchangeCodeForTokens(code: string, origin: string) {
  const { clientId, clientSecret } = googleCredentials();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: driveRedirectUri(origin),
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleCredentials();
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
}

export async function fetchGoogleEmail(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const json = (await res.json()) as { email?: string };
  return json.email ?? "";
}

async function driveFetch(accessToken: string, path: string, search: Record<string, string>) {
  const url = `${DRIVE_API}${path}?${new URLSearchParams(search).toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Drive a répondu ${res.status}. ${body.slice(0, 160)}`);
  }
  return res;
}

/** Dossiers directement contenus dans un dossier (ou la racine "root"). */
export async function listSubfolders(
  accessToken: string,
  parentId: string,
): Promise<DriveFile[]> {
  const res = await driveFetch(accessToken, "/files", {
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name,mimeType)",
    orderBy: "createdTime desc",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

/** Images contenues dans un dossier. */
export async function listImagesInFolder(
  accessToken: string,
  folderId: string,
): Promise<DriveFile[]> {
  const res = await driveFetch(accessToken, "/files", {
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "files(id,name,mimeType)",
    orderBy: "name",
    pageSize: "20",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

export async function downloadDriveFile(accessToken: string, fileId: string) {
  const res = await driveFetch(accessToken, `/files/${fileId}`, {
    alt: "media",
    supportsAllDrives: "true",
  });
  return new Uint8Array(await res.arrayBuffer());
}
