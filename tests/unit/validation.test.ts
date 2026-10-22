import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/server/auth/schemas";
import { ValidationError } from "@/server/errors";
import { createEstablishmentSchema } from "@/server/modules/establishments/service";
import { createOrganizationSchema } from "@/server/modules/organizations/service";
import { parseInput } from "@/server/validation";

describe("validación de entradas", () => {
  it("normaliza el correo y rechaza campos desconocidos", () => {
    expect(parseInput(loginSchema, { email: "  A@B.ES ", password: "x" }).email).toBe("a@b.es");
    expect(() => parseInput(loginSchema, { email: "a@b.es", password: "x", admin: true })).toThrow(
      ValidationError,
    );
  });

  it("aplica la política de contraseñas en el registro", () => {
    expect(() =>
      parseInput(registerSchema, { email: "a@b.es", displayName: "A", password: "corta" }),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(registerSchema, { email: "largo-correo@b.es", displayName: "A", password: "largo-correo@b.es" }),
    ).toThrow(ValidationError);
  });

  it("valida identificadores (slug)", () => {
    expect(parseInput(createOrganizationSchema, { name: "Casa Pepe", slug: "Casa-Pepe" }).slug).toBe("casa-pepe");
    for (const slug of ["ab", "-casa", "casa-", "casa pepe", "casa_pepe", "a".repeat(64)]) {
      expect(() => parseInput(createOrganizationSchema, { name: "X", slug }), slug).toThrow(ValidationError);
    }
  });

  it("valida la zona horaria y no admite organization_id del cliente", () => {
    expect(parseInput(createEstablishmentSchema, { name: "L", slug: "local" }).timezone).toBe("Europe/Madrid");
    expect(() =>
      parseInput(createEstablishmentSchema, { name: "L", slug: "local", timezone: "Marte/Olympus" }),
    ).toThrow(ValidationError);
    expect(() =>
      parseInput(createEstablishmentSchema, { name: "L", slug: "local", organization_id: "x" }),
    ).toThrow(ValidationError);
  });
});
