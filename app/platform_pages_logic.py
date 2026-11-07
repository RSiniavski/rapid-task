"""Site pages (Donate, Terms, Privacy ...): helpers and the first system page.
The pages live in platform.db. A page is public only when its status is "published"."""
from datetime import datetime
from typing import Optional

from app import platform_models as pm
from app import platform_schemas as schemas
from app.platform_db import PlatformSession

DONATE_SLUG = "donate"

_DONATE_UK = """# Small teams. Big things.

Rapid Task допомагає малим командам і незалежним творцям організовувати роботу, рухатись швидше та будувати важливе — без зайвої складності й високих витрат.

## Обери зручний спосіб підтримки

Добровільна підтримка. Продукт безкоштовний — донат допомагає з хостингом, інтернетом та розвитком.

- **PayPal** — Міжнародні платежі карткою або з балансу PayPal. [Підтримати](https://www.paypal.me/YOUR_PAYPAL_NAME)
- **Payoneer** — Переказ через Payoneer для міжнародних платежів. [Підтримати](https://link.payoneer.com/YOUR_PAYONEER_LINK)
- **monobank** — Банка monobank — швидко з української картки. [Підтримати](https://send.monobank.ua/jar/YOUR_JAR_ID)

Дякуємо, що допомагаєте Rapid Task рости ❤️
"""

_DONATE_EN = """# Small teams. Big things.

Rapid Task helps small teams and independent creators organize their work, move faster and build what matters — without unnecessary complexity or high costs.

## Choose a way to support

Voluntary support. The product is free to use — donations help with hosting, internet and development.

- **PayPal** — International payments by card or PayPal balance. [Donate](https://www.paypal.me/YOUR_PAYPAL_NAME)
- **Payoneer** — Transfer via Payoneer for international payments. [Donate](https://link.payoneer.com/YOUR_PAYONEER_LINK)
- **monobank** — monobank jar — quick from a Ukrainian card. [Donate](https://send.monobank.ua/jar/YOUR_JAR_ID)

Thank you for helping Rapid Task grow ❤️
"""


def seed_default_pages() -> None:
    """Creates the Donate page once (as a draft: the links in it are examples). Never changes an existing page."""
    db = PlatformSession()
    try:
        if db.query(pm.SitePage).filter(pm.SitePage.slug == DONATE_SLUG).first() is None:
            db.add(pm.SitePage(
                slug=DONATE_SLUG, title_uk="Донат", title_en="Donations",
                content_uk=_DONATE_UK, content_en=_DONATE_EN,
                status="draft", in_footer=True, in_register=False, sort_order=10, is_system=True,
                updated_by="system", updated_at=datetime.utcnow(),
            ))
            db.commit()
    finally:
        db.close()


def list_item(p: pm.SitePage) -> dict:
    return dict(
        id=p.id, slug=p.slug, title_uk=p.title_uk or "", title_en=p.title_en or "", status=p.status,
        in_footer=p.in_footer, in_register=p.in_register, sort_order=p.sort_order, is_system=p.is_system,
        has_uk=bool((p.content_uk or "").strip()), has_en=bool((p.content_en or "").strip()),
        updated_at=p.updated_at, updated_by=p.updated_by,
    )


def to_list_item(p: pm.SitePage) -> schemas.SitePageListItem:
    return schemas.SitePageListItem(**list_item(p))


def to_out(p: pm.SitePage) -> schemas.SitePageOut:
    return schemas.SitePageOut(**list_item(p), content_uk=p.content_uk or "", content_en=p.content_en or "",
                               created_at=p.created_at)


def publish_problem(p: pm.SitePage) -> Optional[str]:
    """Why the page cannot be published (None = it can)."""
    if not ((p.title_uk or "").strip() or (p.title_en or "").strip()):
        return "The page needs a title"
    if not ((p.content_uk or "").strip() or (p.content_en or "").strip()):
        return "The page needs some text"
    return None
