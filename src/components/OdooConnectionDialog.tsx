import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { saveOdooConnection } from "@/lib/odoo.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type OdooConnection = {
  url: string;
  db_name: string;
  username: string;
  status: string;
};

export function OdooConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connection: OdooConnection | null;
  onSaved: () => void;
}) {
  const save = useServerFn(saveOdooConnection);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    url: connection?.url ?? "",
    db_name: connection?.db_name ?? "",
    username: connection?.username ?? "",
    api_key: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await save({ data: form });
      toast.success(`Odoo connecté — ${res.account}`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion Odoo impossible.");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder: string,
    type = "text",
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type={type}
        required
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connecter votre compte Odoo</DialogTitle>
          <DialogDescription>
            La clé API se génère dans Odoo : Préférences → Sécurité du compte → Nouvelle clé API.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {field("url", "Adresse du site", "https://ma-boutique.odoo.com")}
          {field("db_name", "Base de données", "ma-boutique")}
          {field("username", "Identifiant (e-mail)", "moi@ma-boutique.fr")}
          {field("api_key", "Clé API", "••••••••••••", "password")}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Vérification…" : "Tester et enregistrer"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
