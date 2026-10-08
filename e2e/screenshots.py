"""E2E walk-through of the web build + README screenshots.

Expects a FRESH API (seed only) on :3000 and the web build on :8081:
    DB_PATH=":memory:" npm run start -w @diary/server
    npm run export:web -w @diary/mobile && npx serve -s apps/mobile/dist -l 8081
    pip install playwright && playwright install chromium
    python e2e/screenshots.py            # writes docs/screenshots/*.png
"""

import json
import sys
import urllib.request
from playwright.sync_api import sync_playwright, expect

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/screenshots"
URL = "http://localhost:8081"
NBSP = "\u00a0"  # formatTenge separates groups with a no-break space


def api_day(date):
    with urllib.request.urlopen(f"http://localhost:3000/api/days/{date}") as r:
        return json.load(r)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)

    # Opens on today (2026-10-08): empty day with a shortcut to the last shift.
    expect(page.get_by_text("За этот день поездок нет")).to_be_visible(timeout=20000)
    page.screenshot(path=f"{OUT}/04-empty-day.png")

    page.get_by_text("Последняя смена", exact=False).click()
    expect(page.get_by_test_id("day-title")).to_have_text("7 октября")

    for _ in range(6):
        page.get_by_test_id("prev-day").click()
    expect(page.get_by_test_id("day-title")).to_have_text("1 октября")
    expect(page.get_by_test_id("summary-net")).to_have_text(f"3{NBSP}315{NBSP}₸")
    page.screenshot(path=f"{OUT}/01-day-summary.png")

    # Night trip 01:40 belongs to Oct 2 (UTC would put it on Oct 1).
    page.get_by_test_id("next-day").click()
    expect(page.get_by_test_id("trip-t3")).to_be_visible()
    page.screenshot(path=f"{OUT}/06-night-trips.png")
    page.get_by_test_id("prev-day").click()
    expect(page.get_by_test_id("trip-t3")).to_have_count(0)

    # Validation from the shared core schema: all errors at once.
    page.get_by_test_id("add-trip").click()
    page.get_by_test_id("input-start").fill("10:30")
    page.get_by_test_id("input-end").fill("10:10")
    page.get_by_test_id("input-amount").fill("1200")
    page.get_by_test_id("input-commission").fill("1500")
    page.get_by_test_id("save-trip").click()
    expect(page.get_by_text("Окончание должно быть позже начала")).to_be_visible()
    expect(page.get_by_text("Комиссия не может быть больше суммы")).to_be_visible()
    page.screenshot(path=f"{OUT}/03-validation.png")

    page.get_by_test_id("input-end").fill("10:55")
    page.get_by_test_id("input-commission").fill("180")
    page.get_by_test_id("payment-cash").click()
    page.screenshot(path=f"{OUT}/02-add-trip.png")

    # Lost response: the server STORES the trip, but the client never sees the answer.
    def store_then_drop(route):
        route.fetch()  # request reaches the server and is written
        route.abort("connectionreset")

    page.route("**/api/trips", store_then_drop)
    page.get_by_test_id("save-trip").click()
    expect(page.get_by_text("неизвестно, сохранилась ли поездка", exact=False)).to_be_visible(
        timeout=20000
    )
    expect(page.get_by_test_id("input-amount")).not_to_be_editable()
    page.screenshot(path=f"{OUT}/07-network-error-frozen.png")
    assert api_day("2026-10-01")["summary"]["trips"] == 3, "first attempt must have been stored"

    # Connection is back: "send again" resends the same trip — no duplicate.
    page.unroute("**/api/trips")
    page.get_by_test_id("save-trip").click()
    expect(page.get_by_test_id("summary-net")).to_have_text(f"4{NBSP}335{NBSP}₸")
    page.screenshot(path=f"{OUT}/05-after-add.png")
    day = api_day("2026-10-01")
    assert day["summary"]["trips"] == 3, f"duplicate created: {day['summary']}"

    print("console errors:", [e for e in errors if "Failed to load resource" not in e])
    browser.close()
    print("OK")
