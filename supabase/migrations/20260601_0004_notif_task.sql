ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notif_task boolean NOT NULL DEFAULT true;

-- убрать старую 4-параметровую перегрузку, чтобы не было двусмысленности RPC
DROP FUNCTION IF EXISTS public.update_notification_settings(boolean, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.update_notification_settings(
  p_project_taken boolean,
  p_team_invite   boolean,
  p_comment       boolean,
  p_deadline      boolean,
  p_notif_task    boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles
  SET
    notif_project_taken = p_project_taken,
    notif_team_invite   = p_team_invite,
    notif_comment       = p_comment,
    notif_deadline      = p_deadline,
    notif_task          = p_notif_task
  WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.update_notification_settings(boolean,boolean,boolean,boolean,boolean) TO authenticated;
