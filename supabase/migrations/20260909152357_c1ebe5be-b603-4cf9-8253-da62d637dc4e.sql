CREATE TABLE public.odoo_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE UNIQUE,
  url TEXT NOT NULL,
  db_name TEXT NOT NULL,
  username TEXT NOT NULL,
  api_key TEXT NOT NULL,
  last_checked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odoo_connections TO authenticated;
GRANT ALL ON public.odoo_connections TO service_role;
ALTER TABLE public.odoo_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own odoo connection" ON public.odoo_connections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  images TEXT[] NOT NULL DEFAULT '{}',
  analysis TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  error_message TEXT,
  odoo_product_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own products" ON public.products FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX products_user_created_idx ON public.products (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER odoo_connections_updated_at BEFORE UPDATE ON public.odoo_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.products;

CREATE POLICY "own read product photos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own upload product photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "own delete product photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-photos' AND (storage.foldername(name))[1] = auth.uid()::text);