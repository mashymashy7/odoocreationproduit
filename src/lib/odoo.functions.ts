import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { odooLogin, odooCall } from "./odoo.server";

type ConnInput = { url: string; db_name: string; username: string; api_key: string };

export const saveOdooConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConnInput) => {
    const clean = {
      url: (input?.url ?? "").trim(),
      db_name: (input?.db_name ?? "").trim(),
      username: (input?.username ?? "").trim(),
      api_key: (input?.api_key ?? "").trim(),
    };
    if (!clean.url || !clean.db_name || !clean.username || !clean.api_key) {
      throw new Error("Tous les champs de connexion sont requis.");
    }
    return clean;
  })
  .handler(async ({ data, context }) => {
    const uid = await odooLogin(data);
    const company = await odooCall<{ id: number; name: string }[]>(
      data,
      uid,
      "res.users",
      "read",
      [[uid], ["name"]],
    );

    const { error } = await context.supabase.from("odoo_connections").upsert(
      {
        user_id: context.userId,
        ...data,
        status: "connected",
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("Impossible d'enregistrer la connexion.");

    return { ok: true as const, account: company?.[0]?.name ?? data.username };
  });

export const publishProductToOdoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string }) => {
    if (!input?.productId) throw new Error("Produit introuvable.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { publishProduct } = await import("./odoo-publish.server");
    const { supabase } = context;

    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", data.productId)
      .maybeSingle();
    if (!product) throw new Error("Produit introuvable.");

    const { data: conn } = await supabase
      .from("odoo_connections")
      .select("url, db_name, username, api_key")
      .maybeSingle();
    if (!conn) throw new Error("Connectez d'abord votre compte Odoo.");

    const odooId = await publishProduct(supabase, product, conn);
    return { ok: true as const, odooId };
  });
