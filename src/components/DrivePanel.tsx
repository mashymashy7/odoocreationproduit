import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Cloud, Folder, Loader2, RefreshCw, Settings2 } from "lucide-react";

import {
  disconnectDrive,
  getDriveStatus,
  listDriveFolders,
  runDriveSyncNow,
  setDriveAutoSync,
  setDriveCronSettings,
  setDriveFolder,
  startDriveConnect,
  type DriveStatus,
} from "@/lib/drive.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DriveFolder = { id: string; name: string };

const INTERVALS = [
  { value: 15, label: "Toutes les 15 minutes" },
  { value: 30, label: "Toutes les 30 minutes" },
  { value: 60, label: "Toutes les heures" },
  { value: 180, label: "Toutes les 3 heures" },
  { value: 720, label: "Deux fois par jour" },
  { value: 1440, label: "Une fois par jour" },
];

export function DrivePanel({ onProductsChanged }: { onProductsChanged?: () => void }) {
  const status = useServerFn(getDriveStatus);
  const connect = useServerFn(startDriveConnect);
  const listFolders = useServerFn(listDriveFolders);
  const chooseFolder = useServerFn(setDriveFolder);
  const toggleAuto = useServerFn(setDriveAutoSync);
  const saveSettings = useServerFn(setDriveCronSettings);
  const syncNow = useServerFn(runDriveSyncNow);
  const unlink = useServerFn(disconnectDrive);

  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [trail, setTrail] = useState<DriveFolder[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [interval, setIntervalValue] = useState(15);
  const [maxProducts, setMaxProducts] = useState(3);
  const [autoPublish, setAutoPublish] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await status({});
      setDrive(data);
      if (data) {
        setIntervalValue(data.sync_interval_minutes ?? 15);
        setMaxProducts(data.max_products_per_run ?? 3);
        setAutoPublish(data.auto_publish ?? true);
      }
    } catch {
      setDrive(null);
    }
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin === window.location.origin && event.data?.type === "drive-connected") {
        toast.success("Google Drive est connecté");
        refresh();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  async function openConsent() {
    setBusy(true);
    try {
      const { url } = await connect({});
      window.open(url, "drive-oauth", "width=520,height=680");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function browse(parent: DriveFolder | null) {
    setBusy(true);
    try {
      const res = await listFolders({ data: { parentId: parent?.id ?? "root" } });
      setFolders(res.folders as DriveFolder[]);
      setPicker(true);
      setTrail((prev) => {
        if (!parent) return [];
        const at = prev.findIndex((f) => f.id === parent.id);
        return at >= 0 ? prev.slice(0, at + 1) : [...prev, parent];
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lecture des dossiers impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function selectFolder(folder: DriveFolder) {
    setBusy(true);
    try {
      await chooseFolder({ data: { folderId: folder.id, folderName: folder.name } });
      setPicker(false);
      toast.success(`Dossier surveillé : ${folder.name}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleAuto() {
    if (!drive) return;
    const next = !(drive.auto_sync && !drive.paused);
    setBusy(true);
    try {
      await toggleAuto({ data: { enabled: next } });
      toast.success(next ? "Surveillance automatique activée" : "Surveillance automatique arrêtée");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Modification impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveSettings() {
    setBusy(true);
    try {
      await saveSettings({
        data: { intervalMinutes: interval, maxProducts, autoPublish },
      });
      toast.success("Réglages enregistrés");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onSyncNow() {
    setSyncing(true);
    try {
      const res = await syncNow({});
      if (res.message) toast.message(res.message);
      else if (res.created) toast.success(`${res.created} produit(s) créé(s) depuis Drive`);
      else toast.message("Aucun nouveau dossier détecté.");
      onProductsChanged?.();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Vérification impossible.");
    } finally {
      setSyncing(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    try {
      await unlink({});
      setDrive(null);
      toast.success("Google Drive déconnecté");
    } finally {
      setBusy(false);
    }
  }

  const active = !!drive?.auto_sync && !drive?.paused;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-primary" />
          <div className="leading-tight">
            <h2 className="text-sm font-semibold">Google Drive</h2>
            <p className="label-mono">Un sous-dossier = un produit</p>
          </div>
        </div>
        {drive && (
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
            aria-label="Réglages de la surveillance"
          >
            <Settings2 className="size-4" />
          </button>
        )}
      </div>

      {!drive ? (
        <Button className="mt-4 w-full" onClick={openConsent} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}
          Connecter Google Drive
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Compte relié : <span className="text-foreground">{drive.email || "Google"}</span>
          </p>

          <button
            onClick={() => browse(null)}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary/50"
          >
            <Folder className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {drive.folder_name || "Choisir le dossier à surveiller"}
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>

          {picker && (
            <div className="rounded-lg border border-border bg-background p-2">
              <div className="flex flex-wrap items-center gap-1 px-1 pb-2 text-xs text-muted-foreground">
                <button onClick={() => browse(null)} className="hover:text-foreground">
                  Mon Drive
                </button>
                {trail.map((f) => (
                  <span key={f.id} className="flex items-center gap-1">
                    /
                    <button onClick={() => browse(f)} className="hover:text-foreground">
                      {f.name}
                    </button>
                  </span>
                ))}
              </div>
              {folders.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">Aucun sous-dossier ici.</p>
              ) : (
                <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                  {folders.map((f) => (
                    <li key={f.id} className="flex items-center gap-1">
                      <button
                        onClick={() => browse(f)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary"
                      >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.name}</span>
                      </button>
                      <Button size="sm" variant="outline" onClick={() => selectFolder(f)}>
                        Choisir
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Création automatique</p>
              <p className="label-mono truncate">
                {active ? "Cron actif" : "Cron désactivé"}
                {drive.last_sync_at
                  ? ` · ${new Date(drive.last_sync_at).toLocaleString("fr-FR")}`
                  : ""}
              </p>
            </div>
            <button
              onClick={onToggleAuto}
              disabled={busy || !drive.folder_id}
              role="switch"
              aria-checked={active}
              aria-label="Activer ou désactiver la création automatique"
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                active ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-card transition-all ${
                  active ? "left-5.5" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {showSettings && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="cron-interval">Fréquence de vérification</Label>
                <select
                  id="cron-interval"
                  value={interval}
                  onChange={(e) => setIntervalValue(Number(e.target.value))}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  {INTERVALS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cron-max">Produits maximum par passage</Label>
                <Input
                  id="cron-max"
                  type="number"
                  min={1}
                  max={10}
                  value={maxProducts}
                  onChange={(e) => setMaxProducts(Number(e.target.value))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoPublish}
                  onChange={(e) => setAutoPublish(e.target.checked)}
                  className="size-4 accent-[var(--primary)]"
                />
                Publier automatiquement sur Odoo
              </label>
              <Button size="sm" onClick={onSaveSettings} disabled={busy}>
                Enregistrer les réglages
              </Button>
            </div>
          )}

          {drive.paused && drive.error_message && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {drive.error_message}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSyncNow}
              disabled={syncing || !drive.folder_id}
            >
              {syncing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Vérifier maintenant
            </Button>
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Déconnecter
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
