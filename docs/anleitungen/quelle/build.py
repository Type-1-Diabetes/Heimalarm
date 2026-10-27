"""Baut die Anleitungen (PDF) aus den HTML-Quellen in diesem Ordner.

    python3 docs/anleitungen/quelle/build.py              # alle
    python3 docs/anleitungen/quelle/build.py esp32.html   # nur eine

Braucht Python mit Playwright (pip install playwright, dann: python3 -m playwright install chromium).
Jede <section class="page"> wird eine A4-Seite. {{i:name}} wird durch ein Symbol ersetzt,
Fußzeile und Seitenzahlen im Inhaltsverzeichnis setzt das Skript.
"""
import asyncio
import pathlib
import re
import sys

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent

DOCS = {
    "uebersicht.html": "Heimalarm-Uebersicht.pdf",
    "esp32.html": "Heimalarm-Einrichtung-ESP32.pdf",
    "update.html": "Heimalarm-Update.pdf",
    "geraete.html": "Heimalarm-Geraete-einbinden.pdf",
}

# Symbole wie in der App (app/src/ui/icons.js)
ICONS = {
    "check": '<path d="M20 6 9 17l-5-5"/>',
    "net": '<path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.4a6 6 0 0 1 7 0M2 8.8a16 16 0 0 1 20 0"/><circle cx="12" cy="20" r="1"/>',
    "pause": '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    "pc": '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    "phone": '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    "people": '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>',
    "voice": '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>',
    "lock": '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "paint": '<circle cx="12" cy="12" r="9"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    "tool": '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    "bulb": '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    "flow": '<path d="M4 7h11M4 17h7M18 4l3 3-3 3M15 14l3 3-3 3"/>',
    "home": '<path d="M4 11 12 4l8 7v9H4z"/>',
    "log": '<path d="M6 5h12M6 10h12M6 15h8M6 20h5"/>',
    "chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "server": '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    "chip": '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    "sound": '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    "warn": '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    "gear": '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    "heat": '<path d="M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0Z"/><path d="M12 10v7"/>',
    "cloud": '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/>',
}

def includes(html: str) -> str:
    """{{inc:name|schluessel=wert|…}} fügt teile/name.html ein und ersetzt darin {{schluessel}}."""
    def sub(m):
        name, *args = m.group(1).split("|")
        part = (HERE / "teile" / f"{name}.html").read_text(encoding="utf-8")
        for a in args:
            k, v = a.split("=", 1)
            part = part.replace("{{" + k + "}}", v)
        return part
    return re.sub(r"\{\{inc:([^}]+)\}\}", sub, html)


def icons(html: str) -> str:
    return re.sub(r"\{\{i:(\w+)\}\}", lambda m: f'<svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[m.group(1)]}</svg>', html)

# Fußzeile und Seitenzahlen im Inhaltsverzeichnis
FINISH = """
() => {
  const pages = [...document.querySelectorAll('.page')];
  const doc = document.body.dataset.doc || 'Heimalarm';
  pages.forEach((p, i) => {
    if (p.classList.contains('cover')) return;
    const f = document.createElement('div'); f.className = 'foot';
    f.innerHTML = `<span><b>Heimalarm</b> · ${p.dataset.title || doc}</span><span>${i + 1}</span>`;
    p.append(f);
  });
  document.querySelectorAll('.toc a[href^="#"]').forEach((a) => {
    const t = document.querySelector(a.getAttribute('href'));
    const n = pages.indexOf(t?.closest('.page')) + 1;
    const s = document.createElement('span'); s.textContent = n > 0 ? String(n) : ''; a.append(s);
  });
}
"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        only = sys.argv[1:]
        for src, pdf in DOCS.items():
            if only and src not in only:
                continue
            page = await browser.new_page()
            html = icons(includes((HERE / src).read_text(encoding="utf-8")))
            tmp = HERE / f".{src}"
            tmp.write_text(html, encoding="utf-8")
            await page.goto(tmp.as_uri())
            await page.evaluate("document.fonts.ready")
            await page.evaluate(FINISH)
            await page.pdf(path=str(OUT / pdf), format="A4", print_background=True, prefer_css_page_size=True)
            tmp.unlink()
            print("✓", pdf)
        await browser.close()

asyncio.run(main())
