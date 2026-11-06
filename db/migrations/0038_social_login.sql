-- 0038 — Inicio de sesión con Google, Apple y Facebook (D-061).
--
-- Una cuenta puede no tener contraseña (si se creó con un proveedor) y tener
-- una o varias identidades externas. La identidad se reconoce por el
-- identificador del proveedor (`subject`), nunca por el correo, que puede
-- cambiar. Como users y sessions, solo la usa el módulo de autenticación:
-- sin RLS y con permisos mínimos para el rol de la aplicación.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE user_identities (
  provider      text NOT NULL,
  subject       text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email         citext,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  CONSTRAINT user_identities_provider_check CHECK (provider IN ('google', 'apple', 'facebook')),
  CONSTRAINT user_identities_subject_length CHECK (char_length(subject) BETWEEN 1 AND 255),
  CONSTRAINT user_identities_email_length CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 254),
  -- Una identidad de cada proveedor por cuenta.
  CONSTRAINT user_identities_one_per_provider UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT ON user_identities TO nebora_app;
GRANT UPDATE (email, last_login_at) ON user_identities TO nebora_app;
