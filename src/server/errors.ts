/**
 * Errores de dominio. Sus mensajes son seguros para mostrarse al usuario: no
 * incluyen trazas, SQL ni detalles internos.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(
    message = "Datos no válidos",
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super("validation_error", message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Sesión no válida o caducada") {
    super("unauthenticated", message);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super("invalid_credentials", "Correo o contraseña incorrectos");
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Demasiados intentos. Inténtalo de nuevo más tarde") {
    super("rate_limited", message);
  }
}

/** Se usa también cuando el recurso existe en otra organización, para no revelarlo. */
export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super("not_found", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No tienes permiso para realizar esta acción") {
    super("forbidden", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "El recurso ya existe") {
    super("conflict", message);
  }
}

export class FeatureDisabledError extends AppError {
  constructor(message = "Esta función no está habilitada") {
    super("feature_disabled", message);
  }
}
