CREATE TABLE public.drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  access_token text NOT NULL DEFAULT '',
  refresh_token text NOT NULL DEFAULT '',
  token_expires_at timestamptz,
  folder_id text,
  folder_name text,
  auto_sync boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'connected',
  error_message text,
  paused boolean NOT NULL DEFAULT false,
  lock_until timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_connections TO authenticated;
GRANT ALL ON public.drive_connections TO service_role;
ALTER TABLE public.drive_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own drive connection" ON public.drive_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER drive_connections_updated_at BEFORE UPDATE ON public.drive_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.drive_synced_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id text NOT NULL,
  folder_name text NOT NULL DEFAULT '',
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'processing',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, folder_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drive_synced_folders TO authenticated;
GRANT ALL ON public.drive_synced_folders TO service_role;
ALTER TABLE public.drive_synced_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own drive folders" ON public.drive_synced_folders FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER drive_synced_folders_updated_at BEFORE UPDATE ON public.drive_synced_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.drive_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.drive_oauth_states TO service_role;
ALTER TABLE public.drive_oauth_states ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE public.drive_synced_folders;