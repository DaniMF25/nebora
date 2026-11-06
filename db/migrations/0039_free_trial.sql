-- 0039 — Prueba gratuita de 7 días del plan PRO (D-062).
--
-- Al crear su organización, el propietario prueba el plan PRO durante 7 días
-- (una prueba por persona: no se encadenan pruebas creando organizaciones).
-- Al terminar, la organización pasa sola al plan Básico con las mismas reglas
-- que al bajar de plan a mano: se desactiva la reserva online y el resto queda
-- guardado, sin mostrarse. app.expire_trials() hace ese paso para todas las
-- organizaciones cuya prueba ha terminado; la aplicación la llama al entrar al
-- panel y al servir las páginas públicas.

ALTER TABLE organizations ADD COLUMN trial_ends_at timestamptz;
CREATE INDEX organizations_trial_ends_idx ON organizations (trial_ends_at) WHERE trial_ends_at IS NOT NULL;
-- El cambio de plan del propietario termina la prueba.
GRANT UPDATE (trial_ends_at) ON organizations TO nebora_app;

ALTER TABLE users ADD COLUMN trial_used_at timestamptz;

-- Empieza la prueba de una organización recién creada por el usuario actual,
-- si es su propietario y aún no ha usado su prueba. Devuelve si empezó.
CREATE FUNCTION app.start_trial(p_org uuid, p_days integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := app.current_user_id();
BEGIN
  IF v_user IS NULL OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 30 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
     WHERE organization_id = p_org AND user_id = v_user AND role = 'owner' AND status = 'active'
  ) THEN
    RETURN false;
  END IF;
  -- Una prueba por persona (bloqueando la fila: dos altas a la vez no dan dos pruebas).
  PERFORM 1 FROM public.users WHERE id = v_user AND trial_used_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.users SET trial_used_at = now() WHERE id = v_user;
  UPDATE public.organizations SET plan = 'pro', trial_ends_at = now() + make_interval(days => p_days)
   WHERE id = p_org AND trial_ends_at IS NULL;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION app.start_trial(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.start_trial(uuid, integer) TO nebora_app;

-- Pasa al plan Básico las organizaciones cuya prueba ha terminado. Devuelve cuántas.
CREATE FUNCTION app.expire_trials() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    SELECT id FROM public.organizations WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now() FOR UPDATE SKIP LOCKED
  ), booking AS (
    UPDATE public.reservation_settings s SET public_enabled = false
      FROM expired e WHERE s.organization_id = e.id AND s.public_enabled
  ), invitations AS (
    -- En el Básico no se invita a nadie: las invitaciones abiertas dejan de valer.
    -- Los miembros ya aceptados siguen, con los permisos del Básico (D-062).
    UPDATE public.invitations i SET revoked_at = now()
      FROM expired e WHERE i.organization_id = e.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL
  )
  UPDATE public.organizations o SET plan = 'basic', trial_ends_at = NULL FROM expired e WHERE o.id = e.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION app.expire_trials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_trials() TO nebora_app;

-- Rutas de la web pública de Nébora y de la aplicación que no pueden ser el
-- identificador de una organización (la web de un local vive en /<org>/<local>).
ALTER TABLE organizations DROP CONSTRAINT organizations_slug_not_reserved;
ALTER TABLE organizations ADD CONSTRAINT organizations_slug_not_reserved CHECK (
  slug::text NOT IN ('app', 'api', 'login', 'register', 'invite', 'logout', 'm', 'q', 'r', 'media', 'static',
                     'public', 'admin', 'assets', 'favicon', 'robots', 'sitemap', 'nebora',
                     'auth', 'preview', 'print', 'precios', 'planes', 'funciones', 'prueba', 'demo', 'ayuda',
                     'blog', 'contacto', 'legal', 'privacidad', 'terminos', 'cookies')
);
