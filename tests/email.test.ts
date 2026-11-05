import { describe, it, expect } from "vitest";
import { renderNotificationEmail, escapeHtml } from "@/lib/emailTemplate";

describe("plantilla de email", () => {
  const n = { title: "Nueva propuesta de fecha", body: "Ana / Luis os propone 3 horarios.", match_id: "abc-123", kind: "DATES_PROPOSED" };
  it("enlaza al partido y pone la marca en el asunto", () => {
    const m = renderNotificationEmail(n, "https://liga.example.com/");
    expect(m.subject).toBe("SAQUE LEAGUE · Nueva propuesta de fecha");
    expect(m.html).toContain('href="https://liga.example.com/mi-liga/partido/abc-123"');
    expect(m.html).toContain("Ver el partido");
    expect(m.text).toContain("https://liga.example.com/mi-liga/partido/abc-123");
  });
  it("sin partido enlaza a los avisos", () => {
    const m = renderNotificationEmail({ ...n, match_id: null }, "https://x.test");
    expect(m.html).toContain('href="https://x.test/mi-liga/avisos"');
    expect(m.html).toContain("Ver mis avisos");
  });
  it("escapa el HTML del contenido (nombres y motivos los escriben los usuarios)", () => {
    const m = renderNotificationEmail({ ...n, title: "<b>hola</b>", body: 'Motivo: "<script>alert(1)</script>"' }, "https://x.test");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&lt;b&gt;hola&lt;/b&gt;");
    expect(escapeHtml(`a&b<"'`)).toBe("a&amp;b&lt;&quot;&#39;");
  });
});
