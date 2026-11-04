/**
 * CSV para abrir en Excel en español (D-058): separador «;», decimales con
 * coma, saltos de línea CRLF y marca UTF-8 al principio (sin ella, Excel no
 * reconoce las tildes).
 *
 * Protección contra fórmulas inyectadas (CSV injection): un texto que empieza
 * por =, +, -, @, tabulador o retorno de carro se precede de un apóstrofo, para
 * que la hoja de cálculo lo muestre como texto y no lo ejecute. Los números se
 * escriben tal cual (un -5 de inventario es un número, no una fórmula).
 */
export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? formatNumber(value) : value;
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
