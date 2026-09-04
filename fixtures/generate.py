"""
Generates bank-statement PDF fixtures for the Statement Reconciler demo.

Everything here is invented: the bank, the account holder, the merchants.
Nothing imitates a real institution, and no real person's data is involved.
Amounts are computed with Decimal so the fixtures reconcile exactly.
"""

import random
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

OUT = Path.home() / "fixtures" / "out"
OUT.mkdir(parents=True, exist_ok=True)

BANK = "Northwind Bank"
BRANCH = "Indiranagar Branch, Bengaluru 560038"
HOLDER = "A. FERNANDES"
ACCOUNT = "XXXXXX4417"
IFSC = "NWBK0004417"
PERIOD_START = date(2026, 4, 1)
PERIOD_END = date(2026, 6, 30)
OPENING = Decimal("84250.00")

CREDITS = [
    ("NEFT CR-NWBK0009911-HELICON SYSTEMS PVT LTD-SALARY {m}", Decimal("96400.00")),
    ("UPI/CR/{ref}/Ananya R/NWBK", None),
    ("IMPS/P2A/{ref}/R MENDONCA", None),
    ("NEFT CR-NWBK0002210-VERGE STUDIO-INVOICE {ref4}", None),
    ("INT.PD:{d1} TO {d2}", None),
    ("REV-CARD PURCHASE {ref4} TRAILHEAD COFFEE", None),
]

DEBITS = [
    ("UPI/DR/{ref}/QuickBite Foods/NWBK", None),
    ("UPI/DR/{ref}/MetroMart Retail/NWBK", None),
    ("CARD PURCHASE {ref4} TRAILHEAD COFFEE BLR", None),
    ("ATM WDL {dd}{mon} KORAMANGALA BLR", None),
    ("ACH DR-VERTEXFIN-LOAN EMI", Decimal("18740.00")),
    ("ACH DR-NORTHWIND LIFE-PREMIUM", Decimal("4312.00")),
    ("UPI/DR/{ref}/Kaveri Apartments Assn/NWBK", Decimal("6500.00")),
    ("CHQ NO {ref6} CLG", None),
    ("NEFT DR-NWBK0007712-BESCOM UTILITY", None),
    ("UPI/DR/{ref}/Lumen Broadband/NWBK", Decimal("1499.00")),
]


def inr(amount: Decimal) -> str:
    """Indian digit grouping: 1,24,530.00 rather than 124,530.00."""
    sign = "-" if amount < 0 else ""
    whole, _, frac = f"{abs(amount):.2f}".partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return f"{sign}{whole}.{frac}"


def build_transactions(seed: int):
    """
    Deliberately shaped rather than purely random: three monthly salary
    credits, the recurring debits a real account carries, and a spread of
    everyday spending. A statement that drifts into overdraft would be a
    distraction in a demo.
    """
    rng = random.Random(seed)
    rows = []

    def add(day, description, amount, credit):
        rows.append({"date": day, "description": description,
                     "amount": amount, "credit": credit})

    for month in (4, 5, 6):
        salary_day = date(2026, month, 1)
        add(salary_day,
            f"NEFT CR-NWBK0009911-HELICON SYSTEMS PVT LTD-SALARY "
            f"{salary_day.strftime('%b').upper()}",
            Decimal("96400.00"), True)
        add(date(2026, month, 3), "ACH DR-VERTEXFIN-LOAN EMI",
            Decimal("18740.00"), False)
        add(date(2026, month, 5),
            f"UPI/DR/{rng.randrange(10**11, 10**12)}/Kaveri Apartments Assn/NWBK",
            Decimal("6500.00"), False)
        add(date(2026, month, 8),
            f"UPI/DR/{rng.randrange(10**11, 10**12)}/Lumen Broadband/NWBK",
            Decimal("1499.00"), False)

    add(date(2026, 4, 22), "ACH DR-NORTHWIND LIFE-PREMIUM", Decimal("4312.00"), False)
    add(date(2026, 6, 30),
        f"INT.PD:{PERIOD_START.strftime('%d-%m-%Y')} TO {PERIOD_END.strftime('%d-%m-%Y')}",
        Decimal("1184.00"), True)

    incidental_credits = [
        ("UPI/CR/{ref}/Ananya R/NWBK", Decimal("2400.00")),
        ("IMPS/P2A/{ref}/R MENDONCA", Decimal("5000.00")),
        ("NEFT CR-NWBK0002210-VERGE STUDIO-INVOICE {ref4}", Decimal("14500.00")),
        ("REV-CARD PURCHASE {ref4} TRAILHEAD COFFEE", Decimal("318.00")),
    ]
    for offset, (template, amount) in zip((11, 27, 44, 58), incidental_credits):
        day = PERIOD_START + timedelta(days=offset)
        add(day, template.format(ref=rng.randrange(10**11, 10**12),
                                 ref4=rng.randrange(1000, 9999)), amount, True)

    everyday = [
        "UPI/DR/{ref}/QuickBite Foods/NWBK",
        "UPI/DR/{ref}/MetroMart Retail/NWBK",
        "CARD PURCHASE {ref4} TRAILHEAD COFFEE BLR",
        "ATM WDL {dd}{mon} KORAMANGALA BLR",
        "CHQ NO {ref6} CLG",
        "NEFT DR-NWBK0007712-BESCOM UTILITY",
        "UPI/DR/{ref}/Sona Pharmacy/NWBK",
        "CARD PURCHASE {ref4} WESTLINE FUELS BLR",
    ]
    span = (PERIOD_END - PERIOD_START).days
    for i in range(52):
        day = PERIOD_START + timedelta(days=rng.randrange(2, span))
        template = everyday[i % len(everyday)]
        amount = Decimal(rng.randrange(14900, 650000)) / 100
        add(day, template.format(
            ref=rng.randrange(10**11, 10**12),
            ref4=rng.randrange(1000, 9999),
            ref6=rng.randrange(100000, 999999),
            dd=f"{day.day:02d}", mon=day.strftime("%b").upper()), amount, False)

    rows.sort(key=lambda r: r["date"])

    balance = OPENING
    for r in rows:
        balance = balance + r["amount"] if r["credit"] else balance - r["amount"]
        r["balance"] = balance
    return rows, balance


CSS = """
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 8.4pt; color: #111; margin: 0; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.masthead { border-bottom: 2px solid #1a1a1a; padding-bottom: 6px; margin-bottom: 10px;
            display: flex; justify-content: space-between; align-items: flex-end; }
.bank { font-size: 15pt; font-weight: 700; letter-spacing: .2px; }
.branch { font-size: 7.6pt; color: #444; }
.doctitle { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; }
.meta { display: flex; gap: 26px; margin-bottom: 10px; font-size: 8pt; }
.meta div span { display: inline-block; min-width: 92px; color: #555; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .6px;
     border-bottom: 1px solid #333; border-top: 1px solid #333; padding: 5px 4px; background: #f4f4f2; }
td { padding: 4px; border-bottom: 1px solid #e6e6e3; vertical-align: top; }
td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
td.date, th.date { white-space: nowrap; width: 62px; }
td.desc { font-size: 7.8pt; line-height: 1.35; }
.carry td { background: #fafaf8; font-style: italic; color: #333; }
.opening td { font-weight: 600; }
.summary { margin-top: 14px; border-top: 2px solid #1a1a1a; padding-top: 8px;
           display: flex; gap: 34px; font-size: 8.4pt; }
.summary b { display: block; font-size: 7.4pt; text-transform: uppercase;
             letter-spacing: .6px; color: #555; font-weight: 600; margin-bottom: 2px; }
.pagenum { margin-top: 10px; font-size: 7pt; color: #777; text-align: right; }
.foot { margin-top: 6px; font-size: 6.8pt; color: #888; line-height: 1.4; }
"""


def masthead(page_no, pages):
    return f"""
    <div class="masthead">
      <div><div class="bank">{BANK}</div><div class="branch">{BRANCH}</div></div>
      <div style="text-align:right"><div class="doctitle">Statement of Account</div>
      <div class="branch">Page {page_no} of {pages}</div></div>
    </div>"""


def meta_block():
    return f"""
    <div class="meta">
      <div><div><span>Account name</span>{HOLDER}</div>
           <div><span>Account number</span>{ACCOUNT}</div></div>
      <div><div><span>IFSC</span>{IFSC}</div>
           <div><span>Account type</span>Savings</div></div>
      <div><div><span>Period</span>{PERIOD_START.strftime('%d %b %Y')} to {PERIOD_END.strftime('%d %b %Y')}</div>
           <div><span>Currency</span>INR</div></div>
    </div>"""


def render_html(rows, closing, *, carry_forward_rows: bool, per_page=26):
    chunks = [rows[i:i + per_page] for i in range(0, len(rows), per_page)]
    pages_total = len(chunks)
    html = [f"<html><head><meta charset='utf-8'><style>{CSS}</style></head><body>"]

    for page_index, chunk in enumerate(chunks):
        first = page_index == 0
        last = page_index == pages_total - 1
        html.append("<div class='page'>")
        html.append(masthead(page_index + 1, pages_total))
        if first:
            html.append(meta_block())

        html.append("<table><thead><tr>"
                    "<th class='date'>Date</th><th>Particulars</th>"
                    "<th class='num'>Debit</th><th class='num'>Credit</th>"
                    "<th class='num'>Balance</th></tr></thead><tbody>")

        if first:
            html.append("<tr class='opening'><td class='date'>"
                        f"{PERIOD_START.strftime('%d/%m/%Y')}</td>"
                        "<td class='desc'>OPENING BALANCE</td>"
                        f"<td class='num'></td><td class='num'></td>"
                        f"<td class='num'>{inr(OPENING)}</td></tr>")
        elif carry_forward_rows:
            # The trap. A brought-forward line formatted exactly like a
            # transaction, with the carried balance repeated in the credit
            # column. Extraction that treats it as a row inflates the total.
            carried = chunks[page_index - 1][-1]["balance"]
            html.append("<tr class='carry'><td class='date'>"
                        f"{chunk[0]['date'].strftime('%d/%m/%Y')}</td>"
                        "<td class='desc'>B/F BALANCE BROUGHT FORWARD</td>"
                        f"<td class='num'></td><td class='num'>{inr(carried)}</td>"
                        f"<td class='num'>{inr(carried)}</td></tr>")

        for r in chunk:
            debit = "" if r["credit"] else inr(r["amount"])
            credit = inr(r["amount"]) if r["credit"] else ""
            html.append(
                f"<tr><td class='date'>{r['date'].strftime('%d/%m/%Y')}</td>"
                f"<td class='desc'>{r['description']}</td>"
                f"<td class='num'>{debit}</td><td class='num'>{credit}</td>"
                f"<td class='num'>{inr(r['balance'])}</td></tr>")

        html.append("</tbody></table>")

        if last:
            total_dr = sum((r["amount"] for r in rows if not r["credit"]), Decimal(0))
            total_cr = sum((r["amount"] for r in rows if r["credit"]), Decimal(0))
            html.append(f"""
            <div class="summary">
              <div><b>Opening balance</b>{inr(OPENING)}</div>
              <div><b>Total debits</b>{inr(total_dr)}</div>
              <div><b>Total credits</b>{inr(total_cr)}</div>
              <div><b>Closing balance</b>{inr(closing)}</div>
            </div>
            <div class="foot">This is a computer-generated statement and does not require a signature.
            {BANK} is a fictitious institution; this document is sample data created for software testing.</div>""")

        html.append("</div>")

    html.append("</body></html>")
    return "\n".join(html)


if __name__ == "__main__":
    rows, closing = build_transactions(seed=7)

    clean = render_html(rows, closing, carry_forward_rows=False)
    trap = render_html(rows, closing, carry_forward_rows=True)

    (OUT / "clean.html").write_text(clean)
    (OUT / "carry-forward.html").write_text(trap)

    print(f"rows: {len(rows)}")
    print(f"opening: {inr(OPENING)}")
    print(f"closing: {inr(closing)}")
    dr = sum((r['amount'] for r in rows if not r['credit']), Decimal(0))
    cr = sum((r['amount'] for r in rows if r['credit']), Decimal(0))
    print(f"debits: {inr(dr)}  credits: {inr(cr)}")
    print(f"check: opening - debits + credits = {inr(OPENING - dr + cr)}")
    carried = [r['balance'] for r in rows][15::16]
    print(f"carry-forward decoy amounts: {[inr(c) for c in carried]}")
