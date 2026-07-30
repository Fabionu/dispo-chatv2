from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(r"C:\Users\Home\Desktop\dispo-chatv2")
OUT = ROOT / "output" / "pdf" / "dispo-chat-product-overview.pdf"
IMAGES = ROOT / "output" / "pdf" / "project-images"

W, H = 960.0, 540.0

BG = HexColor("#000000")
CHAT = HexColor("#0C0C0C")
SURFACE = HexColor("#161616")
COMPOSER = HexColor("#1A1A1A")
SURFACE_2 = HexColor("#2D2D2D")
TEXT = HexColor("#F5F5F5")
MUTED = HexColor("#A3A3A3")
FAINT = HexColor("#767676")
ACTIVE = HexColor("#C89572")
DONE = HexColor("#7D8A78")
ALERT = HexColor("#D97757")
WHITE_06 = Color(1, 1, 1, alpha=0.06)
WHITE_10 = Color(1, 1, 1, alpha=0.10)

FONT_REGULAR = "SegoeUI"
FONT_BOLD = "SegoeUI-Bold"
FONT_LIGHT = "SegoeUI-Light"


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_REGULAR, r"C:\Windows\Fonts\segoeui.ttf"))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\segoeuib.ttf"))
    pdfmetrics.registerFont(TTFont(FONT_LIGHT, r"C:\Windows\Fonts\segoeuil.ttf"))


def hex_with_alpha(hex_color: str, alpha: float) -> Color:
    base = HexColor(hex_color)
    return Color(base.red, base.green, base.blue, alpha=alpha)


def rounded_clip(c: canvas.Canvas, x: float, y: float, w: float, h: float, r: float) -> None:
    path = c.beginPath()
    path.roundRect(x, y, w, h, r)
    c.clipPath(path, stroke=0, fill=0)


def image_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def draw_image_cover(
    c: canvas.Canvas,
    path: Path,
    x: float,
    y: float,
    w: float,
    h: float,
    radius: float = 12,
    border: bool = True,
    focus: tuple[float, float] = (0.5, 0.5),
) -> None:
    iw, ih = image_dimensions(path)
    scale = max(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    fx, fy = focus
    dx = x - (dw - w) * fx
    dy = y - (dh - h) * fy

    c.saveState()
    rounded_clip(c, x, y, w, h, radius)
    c.drawImage(ImageReader(str(path)), dx, dy, width=dw, height=dh, mask="auto")
    c.restoreState()
    if border:
        c.setStrokeColor(WHITE_10)
        c.setLineWidth(0.8)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=0)


def draw_image_contain(
    c: canvas.Canvas,
    path: Path,
    x: float,
    y: float,
    w: float,
    h: float,
    radius: float = 12,
    bg=CHAT,
    border: bool = True,
) -> None:
    iw, ih = image_dimensions(path)
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, radius, stroke=0, fill=1)
    c.saveState()
    rounded_clip(c, x, y, w, h, radius)
    c.drawImage(ImageReader(str(path)), dx, dy, width=dw, height=dh, mask="auto")
    c.restoreState()
    if border:
        c.setStrokeColor(WHITE_10)
        c.setLineWidth(0.8)
        c.roundRect(x, y, w, h, radius, stroke=1, fill=0)


def draw_background(c: canvas.Canvas, page_no: int, section: str = "") -> None:
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    # Restrained concentric rings echo the project's chat-box mark.
    c.saveState()
    c.setStrokeColor(hex_with_alpha("#C89572", 0.10))
    c.setLineWidth(0.9)
    cx, cy = W + 70, H + 40
    for r in (120, 165, 210, 255, 300):
        c.circle(cx, cy, r, stroke=1, fill=0)
    c.restoreState()

    # Footer.
    c.setStrokeColor(WHITE_06)
    c.setLineWidth(0.6)
    c.line(42, 27, W - 42, 27)
    c.setFont(FONT_REGULAR, 7.5)
    c.setFillColor(FAINT)
    c.drawString(42, 13, "DISPO CHAT  /  PRODUCT OVERVIEW  /  JULY 2026")
    if section:
        c.drawCentredString(W / 2, 13, section.upper())
    c.drawRightString(W - 42, 13, f"{page_no:02d}")


def draw_logo(c: canvas.Canvas, x: float, y: float, size: float) -> None:
    c.setFillColor(CHAT)
    c.setStrokeColor(WHITE_10)
    c.setLineWidth(0.8)
    c.roundRect(x, y, size, size, size * 0.22, stroke=1, fill=1)

    # Bubble silhouette.
    c.setStrokeColor(TEXT)
    c.setLineWidth(size * 0.045)
    c.circle(x + size * 0.50, y + size * 0.53, size * 0.30, stroke=1, fill=0)
    c.line(x + size * 0.29, y + size * 0.31, x + size * 0.21, y + size * 0.20)
    c.line(x + size * 0.21, y + size * 0.20, x + size * 0.37, y + size * 0.25)

    # Cube.
    cx, cy = x + size * 0.50, y + size * 0.50
    rx, ry = size * 0.18, size * 0.14
    top = (cx, cy + ry)
    right = (cx + rx, cy + ry * 0.28)
    br = (cx + rx, cy - ry * 0.75)
    bottom = (cx, cy - ry * 1.35)
    bl = (cx - rx, cy - ry * 0.75)
    left = (cx - rx, cy + ry * 0.28)
    p = c.beginPath()
    p.moveTo(*top)
    for point in (right, br, bottom, bl, left, top):
        p.lineTo(*point)
    c.drawPath(p, stroke=1, fill=0)
    c.line(*left, cx, cy)
    c.line(cx, cy, *right)
    c.line(cx, cy, *bottom)


def paragraph(
    c: canvas.Canvas,
    text: str,
    x: float,
    y_top: float,
    w: float,
    font: str = FONT_REGULAR,
    size: float = 14,
    color=TEXT,
    leading: float | None = None,
    align: int = TA_LEFT,
    max_h: float = 400,
) -> float:
    style = ParagraphStyle(
        name="deck",
        fontName=font,
        fontSize=size,
        leading=leading or size * 1.28,
        textColor=color,
        alignment=align,
        spaceAfter=0,
        allowWidows=0,
        allowOrphans=0,
    )
    p = Paragraph(text, style)
    _, ph = p.wrap(w, max_h)
    p.drawOn(c, x, y_top - ph)
    return ph


def kicker(c: canvas.Canvas, text: str, x: float, y: float) -> None:
    c.setFillColor(ACTIVE)
    c.setFont(FONT_BOLD, 8.5)
    c.drawString(x, y, text.upper())


def title_block(
    c: canvas.Canvas,
    kicker_text: str,
    title: str,
    subtitle: str | None = None,
    x: float = 48,
    y: float = 489,
    w: float = 850,
    title_size: float = 30,
) -> float:
    kicker(c, kicker_text, x, y)
    title_h = paragraph(c, title, x, y - 14, w, FONT_BOLD, title_size, TEXT, title_size * 1.05)
    cursor = y - 19 - title_h
    if subtitle:
        sub_h = paragraph(c, subtitle, x, cursor - 5, w, FONT_REGULAR, 12.5, MUTED, 17)
        cursor -= sub_h + 8
    return cursor


def draw_pill(c: canvas.Canvas, text: str, x: float, y: float, color=ACTIVE) -> float:
    c.setFont(FONT_BOLD, 8.5)
    tw = c.stringWidth(text, FONT_BOLD, 8.5)
    pw = tw + 22
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.14))
    c.roundRect(x, y, pw, 23, 11.5, stroke=0, fill=1)
    c.setFillColor(color)
    c.drawCentredString(x + pw / 2, y + 7, text)
    return pw


def draw_card(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    title: str | None = None,
    body: str | None = None,
    accent=ACTIVE,
    icon: str | None = None,
    fill=SURFACE,
) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(WHITE_06)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, 12, stroke=1, fill=1)
    tx = x + 18
    if icon:
        c.setFillColor(Color(accent.red, accent.green, accent.blue, alpha=0.15))
        c.circle(x + 25, y + h - 25, 11, stroke=0, fill=1)
        c.setFillColor(accent)
        c.setFont(FONT_BOLD, 10)
        c.drawCentredString(x + 25, y + h - 28.5, icon)
        tx = x + 45
    if title:
        paragraph(c, title, tx, y + h - 16, w - (tx - x) - 16, FONT_BOLD, 12, TEXT, 15)
    if body:
        paragraph(c, body, x + 18, y + h - 44, w - 36, FONT_REGULAR, 9.5, MUTED, 13)


def bullet_list(
    c: canvas.Canvas,
    items: list[str],
    x: float,
    y_top: float,
    w: float,
    size: float = 11,
    gap: float = 11,
    dot_color=ACTIVE,
) -> float:
    y = y_top
    for item in items:
        c.setFillColor(dot_color)
        c.circle(x + 4, y - 7, 2.4, stroke=0, fill=1)
        ph = paragraph(c, item, x + 15, y, w - 15, FONT_REGULAR, size, TEXT, size * 1.35)
        y -= ph + gap
    return y


def browser_frame(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float) -> None:
    c.setFillColor(SURFACE)
    c.setStrokeColor(WHITE_10)
    c.roundRect(x, y, w, h, 14, stroke=1, fill=1)
    c.setFillColor(CHAT)
    c.roundRect(x + 8, y + 8, w - 16, h - 16, 10, stroke=0, fill=1)
    draw_image_cover(c, path, x + 8, y + 8, w - 16, h - 16, 10, border=False)


def phone_frame(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float) -> None:
    c.setFillColor(SURFACE)
    c.setStrokeColor(WHITE_10)
    c.setLineWidth(0.9)
    c.roundRect(x, y, w, h, 28, stroke=1, fill=1)
    c.setFillColor(BG)
    c.roundRect(x + 7, y + 7, w - 14, h - 14, 23, stroke=0, fill=1)
    draw_image_cover(c, path, x + 7, y + 7, w - 14, h - 14, 23, border=False, focus=(0.5, 0.5))
    c.setFillColor(SURFACE_2)
    c.roundRect(x + w * 0.34, y + h - 9, w * 0.32, 3, 1.5, stroke=0, fill=1)


def slide_1(c: canvas.Canvas) -> None:
    draw_background(c, 1, "Cover")
    draw_logo(c, 52, 434, 48)
    c.setFont(FONT_BOLD, 11)
    c.setFillColor(TEXT)
    c.drawString(112, 458, "DISPO CHAT")
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(MUTED)
    c.drawString(112, 442, "TRANSPORT OPERATIONS WORKSPACE")

    paragraph(c, "From message<br/>to milestone.", 52, 385, 390, FONT_BOLD, 42, TEXT, 44)
    paragraph(
        c,
        "A chat-first operating system for dispatchers and drivers - connecting conversations, trips, routes, live status and transport documents.",
        52,
        274,
        350,
        FONT_REGULAR,
        14,
        MUTED,
        20,
    )
    px = 52
    for label in ("DESKTOP", "ANDROID", "REAL-TIME"):
        px += draw_pill(c, label, px, 159) + 8
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(FAINT)
    c.drawString(52, 127, "Product overview based on the current working build")

    browser_frame(c, IMAGES / "desktop-workspace.png", 437, 95, 475, 346)
    c.setFillColor(Color(ACTIVE.red, ACTIVE.green, ACTIVE.blue, alpha=0.16))
    c.roundRect(735, 416, 149, 39, 19.5, stroke=0, fill=1)
    c.setFillColor(ACTIVE)
    c.setFont(FONT_BOLD, 9)
    c.drawCentredString(809.5, 431, "DISPATCH + DRIVER")


def slide_2(c: canvas.Canvas) -> None:
    draw_background(c, 2, "Product")
    title_block(
        c,
        "The opportunity",
        "Transport work is fragmented across too many tools.",
        "Dispo Chat turns the conversation itself into the operational record.",
        w=760,
    )
    paragraph(
        c,
        "Dispatchers usually coordinate one load across chat apps, spreadsheets, maps, phone calls and document folders. Context is lost exactly when the operation becomes time-critical.",
        52,
        365,
        365,
        FONT_REGULAR,
        14,
        MUTED,
        20,
    )
    c.setStrokeColor(Color(ACTIVE.red, ACTIVE.green, ACTIVE.blue, alpha=0.30))
    c.setLineWidth(2)
    c.line(52, 240, 388, 240)
    paragraph(
        c,
        "One room. One vehicle. One trip. One shared timeline.",
        52,
        215,
        355,
        FONT_BOLD,
        22,
        TEXT,
        28,
    )

    cards = [
        ("01", "Chat-first operations", "Messages and operational events share the same timeline."),
        ("02", "Permanent vehicle rooms", "Each truck keeps its identity, crew and history between trips."),
        ("03", "Driver workflow", "Status, route, stops, documents and navigation stay in one mobile flow."),
        ("04", "Company network", "Internal teams and accepted cross-company connections work together safely."),
    ]
    positions = [(452, 292), (690, 292), (452, 128), (690, 128)]
    for (num, t, b), (x, y) in zip(cards, positions):
        draw_card(c, x, y, 216, 142, t, b, icon=num)


def slide_3(c: canvas.Canvas) -> None:
    draw_background(c, 3, "Workspace")
    title_block(
        c,
        "Dispatcher workspace",
        "A single cockpit for conversations and transport tools.",
        w=760,
    )
    browser_frame(c, IMAGES / "desktop-workspace.png", 47, 84, 640, 354)
    bullet_list(
        c,
        [
            "<b>Unified conversation rail</b><br/><font color='#A3A3A3'>Groups, direct messages, unread, archived and presence.</font>",
            "<b>Operational workspace</b><br/><font color='#A3A3A3'>Route planner, fleet status, vehicle rooms and trip creation.</font>",
            "<b>Fast retrieval</b><br/><font color='#A3A3A3'>Conversation filters, full message search and persistent drafts.</font>",
            "<b>Consistent identity</b><br/><font color='#A3A3A3'>Account and company remain visible without leaving the workspace.</font>",
        ],
        720,
        415,
        195,
        10.5,
        13,
    )


def slide_4(c: canvas.Canvas) -> None:
    draw_background(c, 4, "Communication")
    title_block(
        c,
        "Communication",
        "Operational conversations, built around the trip.",
        w=300,
        title_size=28,
    )
    draw_image_cover(
        c,
        IMAGES / "product-conversation-concept.png",
        375,
        74,
        540,
        374,
        14,
        focus=(0.51, 0.52),
    )
    c.setFillColor(Color(BG.red, BG.green, BG.blue, alpha=0.68))
    c.roundRect(391, 88, 186, 24, 12, stroke=0, fill=1)
    c.setFillColor(MUTED)
    c.setFont(FONT_BOLD, 7.5)
    c.drawCentredString(484, 96.5, "PRODUCT INTERACTION MODEL")
    bullet_list(
        c,
        [
            "<b>Real-time messaging</b> with typing, presence, read state and reconnection.",
            "<b>Replies, mentions and grouping</b> optimized for fast scanning.",
            "<b>Search, pin, edit and delete</b> available on desktop and mobile.",
            "<b>Images and documents</b> with previews before sending.",
            "<b>Personal drafts</b> preserved per conversation and device.",
        ],
        54,
        340,
        278,
        11,
        12,
    )


def slide_5(c: canvas.Canvas) -> None:
    draw_background(c, 5, "Trips")
    title_block(
        c,
        "Vehicle rooms",
        "Trip context stays with the truck.",
        w=790,
    )
    draw_image_cover(
        c,
        IMAGES / "desktop-group-info-panel.png",
        495,
        78,
        420,
        366,
        14,
        focus=(0.5, 0.5),
    )

    draw_card(c, 50, 315, 400, 112, "Permanent vehicle identity", "Tractor, trailer, vehicle type, room members and assigned drivers stay with the room between trips.", icon="A")
    draw_card(c, 50, 185, 400, 112, "Structured trip details", "Loading and unloading stops, time windows, references, route geometry and documents are visible without leaving chat.", icon="B")
    draw_card(c, 50, 55, 400, 112, "Live shared state", "Trip status changes update the sidebar, banner, Group Info and Android driver view through the same source of truth.", icon="C")


def slide_6(c: canvas.Canvas) -> None:
    draw_background(c, 6, "Routing")
    title_block(
        c,
        "Route planning",
        "Truck-aware route planning with HERE.",
        w=790,
    )
    browser_frame(c, IMAGES / "desktop-route-planner.png", 47, 68, 668, 342)
    draw_card(c, 742, 318, 173, 92, "HGV routing", "Vehicle dimensions and restrictions can shape the route.", icon="1")
    draw_card(c, 742, 214, 173, 92, "Multi-stop planning", "Loading, unloading and intermediate stops share one route.", icon="2")
    draw_card(c, 742, 110, 173, 92, "Operational reuse", "Saved places, distance, ETA and route geometry feed the trip.", icon="3")
    c.setFont(FONT_REGULAR, 7.5)
    c.setFillColor(FAINT)
    c.drawString(742, 86, "Map data and routing: HERE")


def slide_7(c: canvas.Canvas) -> None:
    draw_background(c, 7, "Android")
    title_block(
        c,
        "Android driver app",
        "The same workspace, optimized for Android.",
        "The Android app keeps the same visual language while prioritizing speed, compactness and one-hand actions.",
        w=820,
    )
    phone_frame(c, IMAGES / "android-conversations.png", 82, 48, 172, 350)
    phone_frame(c, IMAGES / "android-chat.png", 282, 48, 172, 350)

    c.setFillColor(SURFACE)
    c.setStrokeColor(WHITE_06)
    c.roundRect(515, 72, 390, 326, 14, stroke=1, fill=1)
    kicker(c, "Mobile capabilities", 545, 367)
    bullet_list(
        c,
        [
            "<b>Compact conversation list</b> with search, filters and row actions.",
            "<b>Message bubbles tuned for density</b> with grouped shapes and inline timestamps.",
            "<b>Swipe to reply</b> and tap the reply preview to jump to context.",
            "<b>Attachment preview</b> for images and documents before sending.",
            "<b>ML Kit document scanner</b> for clean transport paperwork capture.",
            "<b>High refresh-rate preference</b> for smoother large-group scrolling.",
        ],
        545,
        337,
        325,
        10.5,
        11,
    )


def timeline_node(c: canvas.Canvas, x: float, y: float, label: str, active: bool = False) -> None:
    color = ACTIVE if active else MUTED
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.18))
    c.circle(x, y, 11, stroke=0, fill=1)
    c.setFillColor(color)
    c.circle(x, y, 3.5, stroke=0, fill=1)
    paragraph(c, label, x - 55, y - 19, 110, FONT_BOLD if active else FONT_REGULAR, 8.5, TEXT if active else MUTED, 10, TA_CENTER)


def slide_8(c: canvas.Canvas) -> None:
    draw_background(c, 8, "Driver workflow")
    title_block(
        c,
        "Controlled progress from acceptance to completion.",
        "Automation helps the driver, while document gates protect the operational record.",
        w=820,
    )
    xs = [90, 220, 350, 480, 610, 740, 870]
    labels = ["Planned", "Accepted", "Going to loading", "At loading", "In transit", "At unloading", "Completed"]
    c.setStrokeColor(WHITE_10)
    c.setLineWidth(2)
    c.line(xs[0], 351, xs[-1], 351)
    for i, (x, label) in enumerate(zip(xs, labels)):
        timeline_node(c, x, 351, label, active=i in (1, 4))

    draw_card(
        c,
        50,
        104,
        268,
        164,
        "Foreground geofence",
        "The active trip screen sends location pings and confirms arrival after a dwell near the next stop.",
        icon="G",
    )
    draw_card(
        c,
        346,
        104,
        268,
        164,
        "Manual fallback",
        "When GPS or geofence confirmation is unavailable, the assigned driver can confirm arrival from trip details or navigation.",
        icon="M",
    )
    draw_card(
        c,
        642,
        104,
        268,
        164,
        "Document gate",
        "Loading and delivery documents are scanned and uploaded before protected status transitions can continue.",
        icon="D",
    )
    c.setFillColor(Color(ACTIVE.red, ACTIVE.green, ACTIVE.blue, alpha=0.12))
    c.roundRect(267, 286, 426, 34, 17, stroke=0, fill=1)
    c.setFillColor(ACTIVE)
    c.setFont(FONT_BOLD, 9.5)
    c.drawCentredString(480, 298.5, "ACCEPT  ->  NAVIGATE  ->  ARRIVE  ->  PROVE  ->  PROGRESS")


def slide_9(c: canvas.Canvas) -> None:
    draw_background(c, 9, "Identity")
    title_block(
        c,
        "Identity",
        "Profiles and permissions stay in context.",
        w=820,
    )
    browser_frame(c, IMAGES / "desktop-account.png", 48, 70, 418, 340)
    browser_frame(c, IMAGES / "desktop-my-profile.png", 486, 70, 426, 340)
    c.setFillColor(Color(BG.red, BG.green, BG.blue, alpha=0.78))
    c.roundRect(620, 88, 268, 122, 12, stroke=0, fill=1)
    bullet_list(
        c,
        [
            "<b>Roles:</b> admin, dispatcher, driver and partner.",
            "<b>Editable identity:</b> photo, role, job title, phone and languages.",
            "<b>Presence:</b> live availability with offline and away states.",
        ],
        642,
        185,
        220,
        9.4,
        7,
    )


def connector(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float) -> None:
    c.setStrokeColor(Color(ACTIVE.red, ACTIVE.green, ACTIVE.blue, alpha=0.35))
    c.setLineWidth(1.6)
    c.line(x1, y1, x2, y2)
    angle = math.atan2(y2 - y1, x2 - x1)
    ah = 6
    for off in (2.6, -2.6):
        a = angle + math.pi + off * 0.12
        c.line(x2, y2, x2 + ah * math.cos(a), y2 + ah * math.sin(a))


def arch_box(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str, sub: str, accent=ACTIVE) -> None:
    c.setFillColor(SURFACE)
    c.setStrokeColor(WHITE_10)
    c.roundRect(x, y, w, h, 12, stroke=1, fill=1)
    c.setFillColor(accent)
    c.circle(x + 23, y + h / 2, 7, stroke=0, fill=1)
    paragraph(c, title, x + 42, y + h - 15, w - 54, FONT_BOLD, 10.5, TEXT, 13)
    paragraph(c, sub, x + 42, y + h - 36, w - 54, FONT_REGULAR, 8.2, MUTED, 11)


def slide_10(c: canvas.Canvas) -> None:
    draw_background(c, 10, "Platform")
    title_block(
        c,
        "A platform designed for live operations.",
        "Shared APIs and real-time events keep desktop dispatch and Android driving views synchronized.",
        w=820,
    )
    arch_box(c, 55, 298, 190, 80, "React workspace", "Vite, Tailwind, responsive desktop UI")
    arch_box(c, 55, 183, 190, 80, "Android driver app", "Kotlin, Jetpack Compose, secure session")
    arch_box(c, 374, 240, 210, 96, "Express API + Socket.IO", "Auth, messages, groups, trips, files and real-time fan-out")
    arch_box(c, 715, 330, 190, 66, "PostgreSQL", "Durable operational data", DONE)
    arch_box(c, 715, 247, 190, 66, "Redis", "Multi-instance real-time adapter", DONE)
    arch_box(c, 715, 164, 190, 66, "HERE", "Truck routing and navigation", ACTIVE)
    arch_box(c, 715, 81, 190, 66, "Resend", "Verification and invitations", ACTIVE)
    connector(c, 245, 338, 374, 298)
    connector(c, 245, 223, 374, 276)
    connector(c, 584, 288, 715, 363)
    connector(c, 584, 275, 715, 280)
    connector(c, 584, 260, 715, 197)
    connector(c, 584, 247, 715, 114)

    c.setFillColor(SURFACE)
    c.roundRect(286, 81, 350, 103, 12, stroke=0, fill=1)
    kicker(c, "Security baseline", 310, 158)
    paragraph(
        c,
        "HttpOnly JWT cookies  |  membership-scoped authorization<br/>Zod validation  |  rate limits  |  structured logs",
        310,
        138,
        300,
        FONT_REGULAR,
        9.2,
        MUTED,
        15,
    )


def slide_11(c: canvas.Canvas) -> None:
    draw_background(c, 11, "Current build")
    title_block(
        c,
        "Current build",
        "The dispatcher-to-driver loop is working today.",
        w=820,
    )
    left = [
        "Workspace signup, sign-in and email verification",
        "Vehicle rooms and direct conversations",
        "Real-time messages, typing, presence and unread state",
        "Search, replies, mentions, drafts and message actions",
        "Images, documents, previews and async thumbnails",
        "Profiles, company identity and role-aware settings",
    ]
    right = [
        "Trip creation, stops, status and permanent drivers",
        "HERE route planner and truck profile constraints",
        "Android chat with compact, grouped message UI",
        "Driver acceptance, navigation and manual status controls",
        "Foreground location, geofence confirmation and fallback",
        "ML Kit scanning and proof-required trip transitions",
    ]
    draw_card(c, 50, 90, 410, 300, "DESKTOP + COLLABORATION", None, icon="W")
    draw_card(c, 500, 90, 410, 300, "ANDROID + TRIPS", None, icon="A")
    bullet_list(c, left, 78, 327, 350, 10.4, 10, DONE)
    bullet_list(c, right, 528, 327, 350, 10.4, 10, DONE)
    c.setFillColor(Color(ACTIVE.red, ACTIVE.green, ACTIVE.blue, alpha=0.13))
    c.roundRect(338, 48, 284, 27, 13.5, stroke=0, fill=1)
    c.setFillColor(ACTIVE)
    c.setFont(FONT_BOLD, 8.5)
    c.drawCentredString(480, 57.5, "WEB 0.3.2  /  ANDROID 1.20  /  ACTIVE DEVELOPMENT")


def slide_12(c: canvas.Canvas) -> None:
    draw_background(c, 12, "Direction")
    draw_logo(c, 52, 435, 46)
    kicker(c, "Product direction", 52, 411)
    paragraph(
        c,
        "One continuous record<br/>from dispatch to delivery.",
        52,
        381,
        490,
        FONT_BOLD,
        34,
        TEXT,
        38,
    )
    paragraph(
        c,
        "The next stage is not another isolated feature. It is deeper operational reliability around the workflow that already exists.",
        52,
        275,
        430,
        FONT_REGULAR,
        13,
        MUTED,
        19,
    )
    milestones = [
        ("01", "Durable jobs", "Move attachment processing to a persistent queue."),
        ("02", "Production observability", "Metrics, alerts and error monitoring."),
        ("03", "Efficient file delivery", "Private signed URLs and CDN-backed delivery."),
        ("04", "Remote mobile delivery", "A managed update path for driver devices."),
    ]
    y = 190
    for num, t, b in milestones:
        c.setFillColor(SURFACE)
        c.setStrokeColor(WHITE_06)
        c.roundRect(52, y, 430, 44, 11, stroke=1, fill=1)
        c.setFillColor(ACTIVE)
        c.setFont(FONT_BOLD, 8.5)
        c.drawString(68, y + 28, num)
        c.setFillColor(TEXT)
        c.setFont(FONT_BOLD, 10.5)
        c.drawString(104, y + 26, t)
        c.setFillColor(MUTED)
        c.setFont(FONT_REGULAR, 8.5)
        c.drawString(104, y + 11, b)
        y -= 52

    browser_frame(c, IMAGES / "desktop-workspace.png", 535, 105, 377, 275)
    c.setFillColor(Color(ACTIVE.red, ACTIVE.green, ACTIVE.blue, alpha=0.14))
    c.roundRect(600, 391, 247, 42, 21, stroke=0, fill=1)
    c.setFillColor(ACTIVE)
    c.setFont(FONT_BOLD, 10)
    c.drawCentredString(723.5, 407, "CHAT-FIRST TRANSPORT OPERATIONS")


def build() -> None:
    register_fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("Dispo Chat - Product Overview")
    c.setAuthor("Dispo Chat")
    c.setSubject("Transport operations workspace - desktop and Android")

    slides = [
        slide_1,
        slide_2,
        slide_3,
        slide_4,
        slide_5,
        slide_6,
        slide_7,
        slide_8,
        slide_9,
        slide_10,
        slide_11,
        slide_12,
    ]
    for slide in slides:
        slide(c)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
