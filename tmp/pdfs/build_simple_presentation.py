from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(r"C:\Users\Home\Desktop\dispo-chatv2")
OUT = ROOT / "output" / "pdf" / "dispo-chat-simple-presentation.pdf"

W, H = 960.0, 540.0
BG = HexColor("#000000")
PANEL = HexColor("#111111")
PANEL_ALT = HexColor("#181818")
TEXT = HexColor("#F4F4F4")
MUTED = HexColor("#999999")
FAINT = HexColor("#626262")
ACCENT = HexColor("#C89572")
GREEN = HexColor("#7F977A")
LINE = Color(1, 1, 1, alpha=0.09)

REGULAR = "SegoeUI"
BOLD = "SegoeUI-Bold"
LIGHT = "SegoeUI-Light"


def register_fonts():
    pdfmetrics.registerFont(TTFont(REGULAR, r"C:\Windows\Fonts\segoeui.ttf"))
    pdfmetrics.registerFont(TTFont(BOLD, r"C:\Windows\Fonts\segoeuib.ttf"))
    pdfmetrics.registerFont(TTFont(LIGHT, r"C:\Windows\Fonts\segoeuil.ttf"))


def para(c, text, x, top, width, size=12, color=TEXT, font=REGULAR, leading=None, align=TA_LEFT):
    style = ParagraphStyle(
        "text",
        fontName=font,
        fontSize=size,
        leading=leading or size * 1.32,
        textColor=color,
        alignment=align,
        spaceAfter=0,
    )
    p = Paragraph(text, style)
    _, height = p.wrap(width, 500)
    p.drawOn(c, x, top - height)
    return height


def background(c, page, section):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(48, 29, W - 48, 29)
    c.setFillColor(FAINT)
    c.setFont(REGULAR, 7.5)
    c.drawString(48, 13, "DISPO CHAT  /  PRODUCT PRESENTATION")
    c.drawCentredString(W / 2, 13, section.upper())
    c.drawRightString(W - 48, 13, f"{page:02d}")


def header(c, kicker, title, subtitle=None, width=840):
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(52, 483, kicker.upper())
    title_height = para(c, title, 52, 461, width, 29, TEXT, BOLD, 31)
    if subtitle:
        para(c, subtitle, 52, 452 - title_height, width, 11.5, MUTED, REGULAR, 16)


def card(c, x, y, w, h, number, title, body, accent=ACCENT):
    c.setFillColor(PANEL)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, 12, fill=1, stroke=1)
    c.setFillColor(Color(accent.red, accent.green, accent.blue, alpha=0.16))
    c.circle(x + 26, y + h - 27, 12, fill=1, stroke=0)
    c.setFillColor(accent)
    c.setFont(BOLD, 8.5)
    c.drawCentredString(x + 26, y + h - 30, number)
    para(c, title, x + 48, y + h - 17, w - 66, 11.5, TEXT, BOLD, 14)
    para(c, body, x + 18, y + h - 52, w - 36, 9.5, MUTED, REGULAR, 13)


def pill(c, text, x, y, active=False):
    c.setFont(BOLD, 8.5)
    width = c.stringWidth(text, BOLD, 8.5) + 22
    color = ACCENT if active else MUTED
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.14))
    c.roundRect(x, y, width, 24, 12, fill=1, stroke=0)
    c.setFillColor(color)
    c.drawCentredString(x + width / 2, y + 7.5, text)
    return width


def bullets(c, items, x, top, width, size=10.5, gap=12, dot=ACCENT):
    cursor = top
    for item in items:
        c.setFillColor(dot)
        c.circle(x + 4, cursor - 7, 2.3, fill=1, stroke=0)
        height = para(c, item, x + 16, cursor, width - 16, size, TEXT, REGULAR, size * 1.35)
        cursor -= height + gap
    return cursor


def slide_1(c):
    background(c, 1, "Overview")
    c.setFillColor(ACCENT)
    c.roundRect(52, 447, 42, 4, 2, fill=1, stroke=0)
    c.setFillColor(TEXT)
    c.setFont(BOLD, 10)
    c.drawString(52, 471, "DISPO CHAT")
    para(c, "Transport operations,<br/>organized around chat.", 52, 390, 610, 40, TEXT, BOLD, 43)
    para(
        c,
        "A real-time workspace connecting dispatchers, drivers, conversations, trips, routes and transport documents.",
        52,
        265,
        500,
        14,
        MUTED,
        REGULAR,
        20,
    )
    x = 52
    for label in ("DESKTOP", "ANDROID", "REAL-TIME OPERATIONS"):
        x += pill(c, label, x, 170, active=label == "REAL-TIME OPERATIONS") + 9
    c.setFillColor(PANEL)
    c.roundRect(680, 93, 220, 337, 16, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.circle(790, 354, 7, fill=1, stroke=0)
    c.setStrokeColor(Color(ACCENT.red, ACCENT.green, ACCENT.blue, alpha=0.35))
    c.setLineWidth(1.5)
    c.line(790, 340, 790, 166)
    stages = [("MESSAGE", 323), ("TRIP", 277), ("ROUTE", 231), ("STATUS", 185), ("DELIVERY", 139)]
    for label, y in stages:
        c.setFillColor(PANEL_ALT)
        c.roundRect(718, y - 15, 144, 30, 15, fill=1, stroke=0)
        c.setFillColor(TEXT if label in ("TRIP", "STATUS") else MUTED)
        c.setFont(BOLD, 8)
        c.drawCentredString(790, y - 3, label)
    c.setFillColor(FAINT)
    c.setFont(REGULAR, 8)
    c.drawString(52, 118, "Product overview  /  July 2026")


def slide_2(c):
    background(c, 2, "Product")
    header(
        c,
        "What it is",
        "One operational record for every vehicle and trip.",
        "The conversation becomes the shared timeline for people, decisions and delivery progress.",
    )
    para(
        c,
        "Dispo Chat combines the speed of messaging with the structure required by transport operations.",
        52,
        342,
        380,
        16,
        TEXT,
        BOLD,
        22,
    )
    para(
        c,
        "Instead of switching between chat applications, spreadsheets, maps, calls and document folders, teams work from one synchronized workspace.",
        52,
        255,
        370,
        11.5,
        MUTED,
        REGULAR,
        17,
    )
    card(c, 486, 292, 202, 126, "01", "Chat-first", "Communication remains the fastest way to coordinate daily work.")
    card(c, 710, 292, 202, 126, "02", "Trip-aware", "Each room can carry structured trip, stop and vehicle context.")
    card(c, 486, 142, 202, 126, "03", "Driver-ready", "The Android workflow follows the trip from acceptance to delivery.")
    card(c, 710, 142, 202, 126, "04", "Company-ready", "Roles and permissions keep collaboration controlled.")


def slide_3(c):
    background(c, 3, "Problem and solution")
    header(c, "Why it matters", "Transport coordination is fragmented.", "Critical context is often distributed across tools and people.")
    pain = [
        ("01", "Messages", "Operational decisions disappear inside generic chat threads."),
        ("02", "Trips", "Stops, references and assignments are re-entered repeatedly."),
        ("03", "Status", "Dispatchers depend on calls for progress updates."),
        ("04", "Documents", "Proof of loading and delivery arrives late or without context."),
    ]
    for i, (num, title, body) in enumerate(pain):
        card(c, 52 + i * 221, 238, 199, 139, num, title, body)
    c.setFillColor(PANEL_ALT)
    c.roundRect(52, 91, 862, 111, 14, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(74, 172, "THE DISPO CHAT APPROACH")
    para(
        c,
        "Keep communication, trip data, route progress and documents on the same shared timeline.",
        74,
        151,
        730,
        17,
        TEXT,
        BOLD,
        22,
    )


def slide_4(c):
    background(c, 4, "Communication")
    header(c, "Core workspace", "Messaging designed for operational teams.")
    features = [
        ("01", "Real-time chat", "Direct and group conversations with reconnect-safe updates."),
        ("02", "Presence and typing", "Live availability and immediate collaboration signals."),
        ("03", "Replies and mentions", "Keep fast-moving conversations understandable."),
        ("04", "Search and pinning", "Retrieve important messages without leaving the room."),
        ("05", "Files and previews", "Review images and documents before sending."),
        ("06", "Personal drafts", "Drafts remain private and tied to each conversation."),
    ]
    positions = [(52, 282), (344, 282), (636, 282), (52, 112), (344, 112), (636, 112)]
    for item, (x, y) in zip(features, positions):
        card(c, x, y, 276, 146, *item)


def stage(c, x, y, label, active=False):
    color = ACCENT if active else MUTED
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.18))
    c.circle(x, y, 12, fill=1, stroke=0)
    c.setFillColor(color)
    c.circle(x, y, 3.5, fill=1, stroke=0)
    para(c, label, x - 60, y - 22, 120, 8.5, TEXT if active else MUTED, BOLD if active else REGULAR, 10, TA_CENTER)


def slide_5(c):
    background(c, 5, "Trips")
    header(c, "Trip workflow", "The trip lives inside the vehicle room.", "Vehicle identity and assigned drivers remain stable until dispatch changes them.")
    c.setStrokeColor(LINE)
    c.setLineWidth(2)
    c.line(94, 330, 866, 330)
    labels = ["Planned", "Accepted", "Going to loading", "At loading", "In transit", "At unloading", "Completed"]
    xs = [94, 223, 352, 481, 610, 739, 866]
    for index, (x, label) in enumerate(zip(xs, labels)):
        stage(c, x, 330, label, active=index in (1, 4))
    card(c, 52, 106, 264, 145, "A", "Permanent vehicle room", "Tractor, trailer, members and assigned drivers stay connected between trips.")
    card(c, 348, 106, 264, 145, "B", "Structured stops", "Loading, unloading, references, time windows and route details remain visible.")
    card(c, 644, 106, 264, 145, "C", "Live synchronization", "Trip changes update desktop and Android through the same operational state.")


def slide_6(c):
    background(c, 6, "Android")
    header(c, "Driver application", "A compact workflow built for the road.", "The Android app prioritizes clear status, one-hand actions and minimal navigation.")
    steps = [
        ("01", "Receive", "The assigned driver receives the trip."),
        ("02", "Accept", "Acceptance confirms responsibility."),
        ("03", "Navigate", "Truck-aware directions lead to the next stop."),
        ("04", "Confirm", "Geofence or manual fallback records arrival."),
        ("05", "Complete", "Required documents unlock progress."),
    ]
    for i, (num, title, body) in enumerate(steps):
        x = 52 + i * 174
        c.setFillColor(PANEL)
        c.roundRect(x, 155, 154, 240, 14, fill=1, stroke=0)
        c.setFillColor(ACCENT if i in (1, 2) else FAINT)
        c.setFont(BOLD, 9)
        c.drawString(x + 18, 364, num)
        para(c, title, x + 18, 330, 118, 15, TEXT, BOLD, 19)
        para(c, body, x + 18, 285, 118, 10, MUTED, REGULAR, 14)
        if i < len(steps) - 1:
            c.setStrokeColor(Color(ACCENT.red, ACCENT.green, ACCENT.blue, alpha=0.30))
            c.setLineWidth(1.5)
            c.line(x + 154, 275, x + 174, 275)
    c.setFillColor(Color(ACCENT.red, ACCENT.green, ACCENT.blue, alpha=0.12))
    c.roundRect(287, 92, 386, 35, 17.5, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawCentredString(480, 105, "ACCEPT  -  NAVIGATE  -  ARRIVE  -  PROVE  -  PROGRESS")


def slide_7(c):
    background(c, 7, "Route and documents")
    header(c, "Operational control", "Routes, location and proof work together.")
    c.setFillColor(PANEL)
    c.roundRect(52, 98, 410, 326, 14, fill=1, stroke=0)
    c.setFillColor(PANEL)
    c.roundRect(498, 98, 410, 326, 14, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 9)
    c.drawString(78, 390, "ROUTE AND LOCATION")
    bullets(
        c,
        [
            "<b>HERE truck routing</b><br/><font color='#999999'>Routes can consider HGV dimensions and restrictions.</font>",
            "<b>Multi-stop navigation</b><br/><font color='#999999'>Loading, unloading and intermediate stops share one route.</font>",
            "<b>Foreground location</b><br/><font color='#999999'>The active trip can send progress while navigation is open.</font>",
            "<b>Geofence confirmation</b><br/><font color='#999999'>Arrival is confirmed after the driver remains near the stop.</font>",
        ],
        78,
        354,
        350,
        10.2,
        13,
    )
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 9)
    c.drawString(524, 390, "DOCUMENT CONTROL")
    bullets(
        c,
        [
            "<b>Attachment preview</b><br/><font color='#999999'>Drivers review images and documents before sending.</font>",
            "<b>Automatic scanning</b><br/><font color='#999999'>ML Kit captures and cleans paperwork visible in frame.</font>",
            "<b>Proof-required transitions</b><br/><font color='#999999'>Protected status changes require the correct documents.</font>",
            "<b>Manual fallback</b><br/><font color='#999999'>The driver can progress when GPS confirmation is unavailable.</font>",
        ],
        524,
        354,
        350,
        10.2,
        13,
    )


def system_box(c, x, y, w, title, body, active=False):
    c.setFillColor(PANEL_ALT if active else PANEL)
    c.setStrokeColor(Color(ACCENT.red, ACCENT.green, ACCENT.blue, alpha=0.25) if active else LINE)
    c.roundRect(x, y, w, 72, 11, fill=1, stroke=1)
    c.setFillColor(ACCENT if active else TEXT)
    c.setFont(BOLD, 10)
    c.drawString(x + 16, y + 45, title)
    c.setFillColor(MUTED)
    c.setFont(REGULAR, 8.2)
    c.drawString(x + 16, y + 23, body)


def slide_8(c):
    background(c, 8, "Platform")
    header(c, "Architecture", "One platform, synchronized in real time.")
    system_box(c, 52, 302, 180, "React workspace", "Desktop operations")
    system_box(c, 52, 198, 180, "Android app", "Driver workflow")
    system_box(c, 382, 250, 196, "Express + Socket.IO", "API and live events", True)
    system_box(c, 728, 338, 180, "PostgreSQL", "Operational records")
    system_box(c, 728, 250, 180, "Redis", "Real-time scaling")
    system_box(c, 728, 162, 180, "HERE + Resend", "Routing and email")
    c.setStrokeColor(Color(ACCENT.red, ACCENT.green, ACCENT.blue, alpha=0.32))
    c.setLineWidth(1.4)
    for y1, y2 in ((338, 286), (234, 274)):
        c.line(232, y1, 382, y2)
    for y2 in (374, 286, 198):
        c.line(578, 286, 728, y2)
    c.setFillColor(PANEL)
    c.roundRect(284, 83, 392, 100, 12, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(308, 153, "SECURITY BASELINE")
    para(
        c,
        "HttpOnly JWT cookies  /  role and membership authorization<br/>Zod validation  /  rate limits  /  structured logs",
        308,
        133,
        344,
        9.5,
        MUTED,
        REGULAR,
        15,
    )


def slide_9(c):
    background(c, 9, "Users and value")
    header(c, "For the whole operation", "Different roles, one shared source of truth.")
    roles = [
        ("ADMIN", "Workspace, company and access control"),
        ("DISPATCHER", "Trips, drivers, routes and exceptions"),
        ("DRIVER", "Navigation, status and transport documents"),
        ("PARTNER", "Controlled cross-company collaboration"),
    ]
    for i, (role, body) in enumerate(roles):
        y = 358 - i * 72
        c.setFillColor(PANEL)
        c.roundRect(52, y, 390, 56, 10, fill=1, stroke=0)
        c.setFillColor(ACCENT)
        c.setFont(BOLD, 8.5)
        c.drawString(70, y + 32, role)
        c.setFillColor(MUTED)
        c.setFont(REGULAR, 9)
        c.drawRightString(424, y + 31, body)
    c.setFillColor(PANEL_ALT)
    c.roundRect(500, 142, 408, 272, 14, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(526, 382, "EXPECTED OPERATIONAL VALUE")
    bullets(
        c,
        [
            "Less time spent asking for updates.",
            "Clear ownership for every active trip.",
            "Faster access to route and stop context.",
            "Documents attached to the correct event.",
            "A continuous history from dispatch to delivery.",
        ],
        526,
        348,
        338,
        11,
        15,
        GREEN,
    )


def slide_10(c):
    background(c, 10, "Summary")
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(52, 475, "DISPO CHAT")
    para(c, "From conversation<br/>to completed delivery.", 52, 430, 590, 38, TEXT, BOLD, 42)
    para(
        c,
        "A transport workspace where messaging, trips, drivers, routes, status and documents remain connected.",
        52,
        302,
        540,
        14,
        MUTED,
        REGULAR,
        20,
    )
    points = [
        "One shared operational timeline",
        "Desktop dispatch and Android driver workflows",
        "Real-time trip progress with controlled proof",
    ]
    y = 206
    for i, point in enumerate(points, 1):
        c.setFillColor(PANEL)
        c.roundRect(52, y, 535, 43, 10, fill=1, stroke=0)
        c.setFillColor(ACCENT)
        c.setFont(BOLD, 8.5)
        c.drawString(70, y + 17, f"0{i}")
        c.setFillColor(TEXT)
        c.setFont(BOLD, 10)
        c.drawString(108, y + 16, point)
        y -= 54
    c.setFillColor(PANEL_ALT)
    c.roundRect(674, 105, 234, 302, 16, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.circle(791, 341, 6, fill=1, stroke=0)
    c.setStrokeColor(Color(ACCENT.red, ACCENT.green, ACCENT.blue, alpha=0.3))
    c.setLineWidth(1.4)
    c.line(791, 325, 791, 192)
    labels = [("CHAT", 305), ("TRIP", 267), ("DRIVER", 229), ("DELIVERY", 191)]
    for label, y_pos in labels:
        c.setFillColor(PANEL)
        c.roundRect(723, y_pos - 13, 136, 27, 13.5, fill=1, stroke=0)
        c.setFillColor(TEXT if label in ("TRIP", "DELIVERY") else MUTED)
        c.setFont(BOLD, 8)
        c.drawCentredString(791, y_pos - 3, label)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 10)
    c.drawCentredString(791, 139, "ONE CONTINUOUS RECORD")


def build():
    register_fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("Dispo Chat - Simple Product Presentation")
    c.setAuthor("Dispo Chat")
    c.setSubject("Transport operations workspace")
    for slide in (slide_1, slide_2, slide_3, slide_4, slide_5, slide_6, slide_7, slide_8, slide_9, slide_10):
        slide(c)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
