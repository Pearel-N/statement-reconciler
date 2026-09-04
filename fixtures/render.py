import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path.home() / "fixtures" / "out"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        for name in ("clean", "carry-forward"):
            await page.goto((OUT / f"{name}.html").as_uri())
            await page.pdf(path=str(OUT / f"{name}.pdf"), format="A4",
                           print_background=True,
                           margin={"top": "14mm", "bottom": "14mm",
                                   "left": "12mm", "right": "12mm"})
            print("rendered", name)
        await browser.close()

asyncio.run(main())
