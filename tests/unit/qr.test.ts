import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { menuShortUrl, renderQrPng, renderQrSvg } from "@/server/modules/menus/qr";

describe("códigos QR", () => {
  it("construye el enlace corto y valida el código", () => {
    expect(menuShortUrl("https://carta.example.com", "0123456789ab")).toBe("https://carta.example.com/q/0123456789ab");
    expect(() => menuShortUrl("https://carta.example.com", "../admin")).toThrow();
  });

  it("codifica exactamente el enlace corto", () => {
    const url = menuShortUrl("https://carta.example.com", "0123456789ab");
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    expect(qr.segments.map((s) => Buffer.from(s.data as unknown as number[]).toString("utf8")).join("")).toBe(url);
  });

  it("genera SVG determinista y PNG válido", async () => {
    const url = "https://carta.example.com/q/0123456789ab";
    const svg = await renderQrSvg(url);
    expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).not.toMatch(/<script/i);
    expect(await renderQrSvg(url)).toBe(svg);
    const png = await renderQrPng(url);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
