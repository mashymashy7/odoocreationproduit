export type OdooCredentials = {
  url: string;
  db_name: string;
  username: string;
  api_key: string;
};

function normalizeUrl(raw: string) {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

async function rpc(url: string, params: Record<string, unknown>) {
  const res = await fetch(`${normalizeUrl(url)}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params, id: Date.now() }),
  });

  if (!res.ok) {
    throw new Error(`Odoo a répondu avec le code ${res.status}. Vérifiez l'adresse du site.`);
  }

  const json = (await res.json()) as {
    result?: unknown;
    error?: { message?: string; data?: { message?: string } };
  };

  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || "Erreur Odoo inconnue.");
  }
  return json.result;
}

export async function odooLogin(creds: OdooCredentials): Promise<number> {
  const uid = (await rpc(creds.url, {
    service: "common",
    method: "login",
    args: [creds.db_name, creds.username, creds.api_key],
  })) as number | false;

  if (!uid) {
    throw new Error("Identifiants Odoo refusés. Vérifiez la base, l'identifiant et la clé API.");
  }
  return uid;
}

export async function odooCall<T>(
  creds: OdooCredentials,
  uid: number,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  return (await rpc(creds.url, {
    service: "object",
    method: "execute_kw",
    args: [creds.db_name, uid, creds.api_key, model, method, args, kwargs],
  })) as T;
}

export async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Photo introuvable.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function publicUrl() {
  return normalizeUrl;
}
