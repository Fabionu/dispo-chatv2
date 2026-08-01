from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(r"C:\Users\Home\Desktop\dispo-chatv2")
OUT_EN = ROOT / "output" / "pdf" / "dispo-chat-simple-presentation-corrected.pdf"
OUT_RO = ROOT / "output" / "pdf" / "dispo-chat-prezentare-romana.pdf"

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
LANGUAGE = "en"


RO = {
    "Overview": "Prezentare",
    "Product": "Produs",
    "Problem and solution": "Problemă și soluție",
    "Communication": "Comunicare",
    "Trips": "Curse",
    "Android": "Android",
    "Route and documents": "Rută și documente",
    "Platform": "Platformă",
    "Users and value": "Utilizatori și valoare",
    "Summary": "Concluzie",
    "PRODUCT PRESENTATION": "PREZENTARE PRODUS",
    "Transport operations,<br/>organized around chat.": "Operațiuni de transport,<br/>organizate în jurul conversației.",
    "A real-time workspace connecting dispatchers, drivers, conversations, trips, routes and transport documents.": "Un spațiu de lucru în timp real care conectează dispeceri, șoferi, conversații, curse, rute și documente de transport.",
    "DESKTOP": "DESKTOP",
    "ANDROID": "ANDROID",
    "REAL-TIME OPERATIONS": "OPERAȚIUNI ÎN TIMP REAL",
    "MESSAGE": "MESAJ",
    "TRIP": "CURSĂ",
    "ROUTE": "RUTĂ",
    "STATUS": "STATUS",
    "DELIVERY": "LIVRARE",
    "Product overview  /  July 2026": "Prezentare produs  /  Iulie 2026",
    "What it is": "Ce este",
    "One operational record for every vehicle and trip.": "Un singur istoric pentru fiecare vehicul și cursă.",
    "The conversation becomes the shared timeline for people, decisions and delivery progress.": "Conversația devine istoricul comun pentru oameni, decizii și progresul livrării.",
    "Dispo Chat combines the speed of messaging with the structure required by transport operations.": "Dispo Chat combină viteza mesageriei cu structura necesară operațiunilor de transport.",
    "Instead of switching between chat applications, spreadsheets, maps, calls and document folders, teams work from one synchronized workspace.": "În loc să schimbe aplicații de chat, tabele, hărți, apeluri și dosare, echipele lucrează într-un singur spațiu sincronizat.",
    "Chat-first": "Conversația pe primul loc",
    "Communication remains the fastest way to coordinate daily work.": "Comunicarea rămâne cea mai rapidă metodă de coordonare a activității zilnice.",
    "Trip-aware": "Conectat la cursă",
    "Each room can carry structured trip, stop and vehicle context.": "Fiecare grup include context structurat despre cursă, opriri și vehicul.",
    "Driver-ready": "Pregătit pentru șofer",
    "The Android workflow follows the trip from acceptance to delivery.": "Fluxul Android urmărește cursa de la acceptare până la livrare.",
    "Company-ready": "Pregătit pentru companie",
    "Roles and permissions keep collaboration controlled.": "Rolurile și permisiunile mențin colaborarea sub control.",
    "Why it matters": "De ce contează",
    "Transport coordination is fragmented.": "Coordonarea transportului este fragmentată.",
    "Critical context is often distributed across tools and people.": "Informațiile esențiale sunt adesea împărțite între instrumente și persoane.",
    "Messages": "Mesaje",
    "Operational decisions disappear inside generic chat threads.": "Deciziile operaționale se pierd în conversații generice.",
    "Trips": "Curse",
    "Stops, references and assignments are re-entered repeatedly.": "Opririle, referințele și alocările sunt introduse în mod repetat.",
    "Status": "Status",
    "Dispatchers depend on calls for progress updates.": "Dispecerii depind de apeluri pentru actualizări despre progres.",
    "Documents": "Documente",
    "Proof of loading and delivery arrives late or without context.": "Dovezile de încărcare și livrare ajung târziu sau fără context.",
    "THE DISPO CHAT APPROACH": "ABORDAREA DISPO CHAT",
    "Keep communication, trip data, route progress and documents on the same shared timeline.": "Păstrează comunicarea, datele cursei, progresul rutei și documentele în același istoric comun.",
    "Core workspace": "Spațiul principal",
    "Messaging designed for operational teams.": "Mesagerie concepută pentru echipe operaționale.",
    "Real-time chat": "Chat în timp real",
    "Direct and group conversations with reconnect-safe updates.": "Conversații directe și de grup, actualizate sigur după reconectare.",
    "Presence and typing": "Prezență și tastare",
    "Live availability and immediate collaboration signals.": "Disponibilitate live și indicatori imediați de colaborare.",
    "Replies and mentions": "Răspunsuri și mențiuni",
    "Keep fast-moving conversations understandable.": "Conversațiile rapide rămân ușor de urmărit.",
    "Search and pinning": "Căutare și fixare",
    "Retrieve important messages without leaving the room.": "Găsește mesajele importante fără să părăsești conversația.",
    "Files and previews": "Fișiere și previzualizări",
    "Review images and documents before sending.": "Verifică imaginile și documentele înainte de trimitere.",
    "Personal drafts": "Ciorne personale",
    "Drafts remain private and tied to each conversation.": "Ciornele rămân private și asociate fiecărei conversații.",
    "Trip workflow": "Fluxul cursei",
    "The trip lives inside the vehicle room.": "Cursa rămâne în grupul vehiculului.",
    "Vehicle identity and assigned drivers remain stable until dispatch changes them.": "Identitatea vehiculului și șoferii alocați rămân neschimbați până la modificarea manuală.",
    "Planned": "Planificată",
    "Accepted": "Acceptată",
    "Going to loading": "Spre încărcare",
    "At loading": "La încărcare",
    "In transit": "În tranzit",
    "At unloading": "La descărcare",
    "Completed": "Finalizată",
    "Permanent vehicle room": "Grup permanent al vehiculului",
    "Tractor, trailer, members and assigned drivers stay connected between trips.": "Capul tractor, remorca, membrii și șoferii alocați rămân asociați între curse.",
    "Structured stops": "Opriri structurate",
    "Loading, unloading, references, time windows and route details remain visible.": "Încărcarea, descărcarea, referințele, intervalele și ruta rămân vizibile.",
    "Live synchronization": "Sincronizare live",
    "Trip changes update desktop and Android through the same operational state.": "Modificările cursei actualizează simultan versiunile desktop și Android.",
    "Driver application": "Aplicația șoferului",
    "A compact workflow built for the road.": "Un flux compact, construit pentru drum.",
    "The Android app prioritizes clear status, one-hand actions and minimal navigation.": "Aplicația Android prioritizează statusul clar, acțiunile rapide și navigarea simplă.",
    "Receive": "Primește",
    "The assigned driver receives the trip.": "Șoferul alocat primește cursa.",
    "Accept": "Acceptă",
    "Acceptance confirms responsibility.": "Acceptarea confirmă responsabilitatea.",
    "Navigate": "Navighează",
    "Truck-aware directions lead to the next stop.": "Ruta pentru camion conduce către următoarea oprire.",
    "Confirm": "Confirmă",
    "Geofence or manual fallback records arrival.": "Geofence-ul sau confirmarea manuală înregistrează sosirea.",
    "Complete": "Finalizează",
    "Required documents unlock progress.": "Documentele obligatorii permit continuarea.",
    "ACCEPT  -  NAVIGATE  -  ARRIVE  -  PROVE  -  PROGRESS": "ACCEPTĂ  -  NAVIGHEAZĂ  -  AJUNGE  -  DOVEDEȘTE  -  CONTINUĂ",
    "Operational control": "Control operațional",
    "Routes, location and proof work together.": "Ruta, locația și documentele lucrează împreună.",
    "ROUTE AND LOCATION": "RUTĂ ȘI LOCAȚIE",
    "<b>HERE truck routing</b><br/><font color='#999999'>Routes can consider HGV dimensions and restrictions.</font>": "<b>Rutare HERE pentru camion</b><br/><font color='#999999'>Ruta poate ține cont de dimensiuni și restricții HGV.</font>",
    "<b>Multi-stop navigation</b><br/><font color='#999999'>Loading, unloading and intermediate stops share one route.</font>": "<b>Navigare cu opriri multiple</b><br/><font color='#999999'>Încărcarea, descărcarea și opririle intermediare folosesc aceeași rută.</font>",
    "<b>Foreground location</b><br/><font color='#999999'>The active trip can send progress while navigation is open.</font>": "<b>Locație în prim-plan</b><br/><font color='#999999'>Cursa activă poate transmite progresul cât timp navigarea este deschisă.</font>",
    "<b>Geofence confirmation</b><br/><font color='#999999'>Arrival is confirmed after the driver remains near the stop.</font>": "<b>Confirmare prin geofence</b><br/><font color='#999999'>Sosirea este confirmată după ce șoferul rămâne în apropierea opririi.</font>",
    "DOCUMENT CONTROL": "CONTROLUL DOCUMENTELOR",
    "<b>Attachment preview</b><br/><font color='#999999'>Drivers review images and documents before sending.</font>": "<b>Previzualizarea atașamentelor</b><br/><font color='#999999'>Șoferii verifică imaginile și documentele înainte de trimitere.</font>",
    "<b>Automatic scanning</b><br/><font color='#999999'>ML Kit captures and cleans paperwork visible in frame.</font>": "<b>Scanare automată</b><br/><font color='#999999'>ML Kit capturează și corectează documentele vizibile în cadru.</font>",
    "<b>Proof-required transitions</b><br/><font color='#999999'>Protected status changes require the correct documents.</font>": "<b>Tranziții condiționate de documente</b><br/><font color='#999999'>Schimbările protejate de status necesită actele corecte.</font>",
    "<b>Manual fallback</b><br/><font color='#999999'>The driver can progress when GPS confirmation is unavailable.</font>": "<b>Confirmare manuală</b><br/><font color='#999999'>Șoferul poate continua când confirmarea GPS nu este disponibilă.</font>",
    "Architecture": "Arhitectură",
    "One platform, synchronized in real time.": "O singură platformă, sincronizată în timp real.",
    "React workspace": "Spațiu React",
    "Desktop operations": "Operațiuni desktop",
    "Android app": "Aplicație Android",
    "Driver workflow": "Fluxul șoferului",
    "API and live events": "API și evenimente live",
    "Operational records": "Date operaționale",
    "Real-time scaling": "Scalare în timp real",
    "Routing and email": "Rutare și email",
    "SECURITY BASELINE": "BAZA DE SECURITATE",
    "HttpOnly JWT cookies  /  role and membership authorization<br/>Zod validation  /  rate limits  /  structured logs": "Cookie-uri JWT HttpOnly  /  autorizare după rol și apartenență<br/>Validare Zod  /  limitare trafic  /  jurnale structurate",
    "For the whole operation": "Pentru întreaga operațiune",
    "Different roles, one shared source of truth.": "Roluri diferite, aceeași sursă de adevăr.",
    "ADMIN": "ADMIN",
    "Workspace, company and access control": "Controlul spațiului, companiei și accesului",
    "DISPATCHER": "DISPECER",
    "Trips, drivers, routes and exceptions": "Curse, șoferi, rute și excepții",
    "DRIVER": "ȘOFER",
    "Navigation, status and transport documents": "Navigare, status și documente de transport",
    "PARTNER": "PARTENER",
    "Controlled cross-company collaboration": "Colaborare controlată între companii",
    "EXPECTED OPERATIONAL VALUE": "VALOARE OPERAȚIONALĂ",
    "Less time spent asking for updates.": "Mai puțin timp pierdut cerând actualizări.",
    "Clear ownership for every active trip.": "Responsabilitate clară pentru fiecare cursă activă.",
    "Faster access to route and stop context.": "Acces rapid la rută și la detaliile opririlor.",
    "Documents attached to the correct event.": "Documente asociate evenimentului corect.",
    "A continuous history from dispatch to delivery.": "Un istoric continuu de la dispecerizare la livrare.",
    "From conversation<br/>to completed delivery.": "De la conversație<br/>la livrare finalizată.",
    "A transport workspace where messaging, trips, drivers, routes, status and documents remain connected.": "Un spațiu de transport în care mesajele, cursele, șoferii, rutele, statusul și documentele rămân conectate.",
    "One shared operational timeline": "Un singur istoric operațional comun",
    "Desktop dispatch and Android driver workflows": "Dispecerizare desktop și flux Android pentru șofer",
    "Real-time trip progress with controlled proof": "Progres live al cursei, condiționat de documente",
    "CHAT": "CHAT",
    "DRIVER": "ȘOFER",
    "ONE CONTINUOUS RECORD": "UN SINGUR ISTORIC CONTINUU",
}


def tr(text):
    return RO.get(text, text) if LANGUAGE == "ro" else text


def register_fonts():
    pdfmetrics.registerFont(TTFont(REGULAR, r"C:\Windows\Fonts\segoeui.ttf"))
    pdfmetrics.registerFont(TTFont(BOLD, r"C:\Windows\Fonts\segoeuib.ttf"))
    pdfmetrics.registerFont(TTFont(LIGHT, r"C:\Windows\Fonts\segoeuil.ttf"))


def para(c, text, x, top, width, size=12, color=TEXT, font=REGULAR, leading=None, align=TA_LEFT):
    text = tr(text)
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
    c.drawString(48, 13, f"DISPO CHAT  /  {tr('PRODUCT PRESENTATION')}")
    c.drawCentredString(W / 2, 13, tr(section).upper())
    c.drawRightString(W - 48, 13, f"{page:02d}")


def header(c, kicker, title, subtitle=None, width=840):
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(52, 483, tr(kicker).upper())
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
    display_text = tr(text)
    c.setFont(BOLD, 8.5)
    width = c.stringWidth(display_text, BOLD, 8.5) + 22
    color = ACCENT if active else MUTED
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.14))
    c.roundRect(x, y, width, 24, 12, fill=1, stroke=0)
    c.setFillColor(color)
    c.drawCentredString(x + width / 2, y + 7.5, display_text)
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
        c.drawCentredString(790, y - 3, tr(label))
    c.setFillColor(FAINT)
    c.setFont(REGULAR, 8)
    c.drawString(52, 118, tr("Product overview  /  July 2026"))


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
    card(c, 486, 252, 202, 120, "01", "Chat-first", "Communication remains the fastest way to coordinate daily work.")
    card(c, 710, 252, 202, 120, "02", "Trip-aware", "Each room can carry structured trip, stop and vehicle context.")
    card(c, 486, 112, 202, 120, "03", "Driver-ready", "The Android workflow follows the trip from acceptance to delivery.")
    card(c, 710, 112, 202, 120, "04", "Company-ready", "Roles and permissions keep collaboration controlled.")


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
    c.drawString(74, 172, tr("THE DISPO CHAT APPROACH"))
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
    positions = [(52, 245), (344, 245), (636, 245), (52, 85), (344, 85), (636, 85)]
    for item, (x, y) in zip(features, positions):
        card(c, x, y, 276, 140, *item)


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
    c.drawCentredString(480, 105, tr("ACCEPT  -  NAVIGATE  -  ARRIVE  -  PROVE  -  PROGRESS"))


def slide_7(c):
    background(c, 7, "Route and documents")
    header(c, "Operational control", "Routes, location and proof work together.")
    c.setFillColor(PANEL)
    c.roundRect(52, 98, 410, 326, 14, fill=1, stroke=0)
    c.setFillColor(PANEL)
    c.roundRect(498, 98, 410, 326, 14, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 9)
    c.drawString(78, 390, tr("ROUTE AND LOCATION"))
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
    c.drawString(524, 390, tr("DOCUMENT CONTROL"))
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
    c.drawString(x + 16, y + 45, tr(title))
    c.setFillColor(MUTED)
    c.setFont(REGULAR, 8.2)
    c.drawString(x + 16, y + 23, tr(body))


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
    c.drawString(308, 153, tr("SECURITY BASELINE"))
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
        c.drawString(70, y + 32, tr(role))
        c.setFillColor(MUTED)
        c.setFont(REGULAR, 9)
        c.drawRightString(424, y + 31, tr(body))
    c.setFillColor(PANEL_ALT)
    c.roundRect(500, 142, 408, 272, 14, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 8.5)
    c.drawString(526, 382, tr("EXPECTED OPERATIONAL VALUE"))
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
        c.drawString(108, y + 16, tr(point))
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
        c.drawCentredString(791, y_pos - 3, tr(label))
    c.setFillColor(ACCENT)
    c.setFont(BOLD, 10)
    c.drawCentredString(791, 139, tr("ONE CONTINUOUS RECORD"))


def build(language):
    global LANGUAGE
    LANGUAGE = language
    output = OUT_RO if language == "ro" else OUT_EN
    output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output), pagesize=(W, H), pageCompression=1)
    c.setTitle(
        "Dispo Chat - Prezentare produs"
        if language == "ro"
        else "Dispo Chat - Simple Product Presentation"
    )
    c.setAuthor("Dispo Chat")
    c.setSubject(
        "Spațiu de lucru pentru operațiuni de transport"
        if language == "ro"
        else "Transport operations workspace"
    )
    for slide in (slide_1, slide_2, slide_3, slide_4, slide_5, slide_6, slide_7, slide_8, slide_9, slide_10):
        slide(c)
        c.showPage()
    c.save()
    print(output)


if __name__ == "__main__":
    register_fonts()
    build("en")
    build("ro")
