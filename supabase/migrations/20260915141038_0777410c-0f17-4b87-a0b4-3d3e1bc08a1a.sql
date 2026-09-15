ALTER TABLE public.drive_connections
  ADD COLUMN IF NOT EXISTS sync_interval_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_products_per_run integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT true;

ALTER TABLE public.drive_connections
  ADD CONSTRAINT drive_connections_interval_check CHECK (sync_interval_minutes BETWEEN 5 AND 1440),
  ADD CONSTRAINT drive_connections_max_products_check CHECK (max_products_per_run BETWEEN 1 AND 10);