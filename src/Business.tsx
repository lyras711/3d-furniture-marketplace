import { useEffect, useState } from 'react'
import './showcase.css'
import './business.css'

type Language = 'en' | 'de' | 'el'
type BusinessCopy = {
  meta: { title: string; description: string; shareDescription: string }
  skip: string
  homeLabel: string
  audience: string
  navigationLabel: string
  nav: [string, string, string]
  customerDemo: string
  menu: { openNavigation: string; closeNavigation: string; open: string; close: string }
  hero: {
    kicker: string; titleStart: string; titleEnd: string; description: string; contact: string; howLink: string; note: string
    imageAlt: string; viewLabel: string; catalogue: string; artTitle: string; dimensionsNote: string; artCaption: string
    bottomLine: string; scrollLink: string
  }
  valueProps: [string, string, string]
  problem: {
    index: string; productQuestion: string; productAnswer: string; roomQuestion: string; roomAnswer: string
    description: string; caseLabel: string; caseTitle: string; caseDescription: string
  }
  journey: {
    index: string; titleStart: string; titleEnd: string; description: string; inputsLabel: string; roomDimensions: string; layoutPhoto: string
    drawLabel: string; drawTitle: string; drawDescription: string; photoLabel: string; photoTitle: string; photoDescription: string
  }
  steps: { title: string; description: string; label: string }[]
  pilot: {
    imageAlt: string; imageLabel: string; sampleNote: string; sectionIndex: string; title: string; description: string
    steps: [string, string, string]; contact: string; emailNote: string
  }
  integration: {
    index: string; titleStart: string; titleEnd: string; description: string; architectureLabel: string
    catalogue: string; catalogueDetails: string; spatialLayer: string; spatialDetails: string
    commercialFlow: string; commercialDetails: string; note: string
  }
  faq: { index: string; titleStart: string; titleEnd: string; questions: { question: string; answer: string }[] }
  final: { topLine: string; titleStart: string; titleEnd: string; descriptionStart: string; descriptionEnd: string; contact: string; planner: string }
  footer: { description: string; planner: string; backToTop: string; language: string; prototype: string }
  emailSubject: string
  emailBody: string
}

const translations: Record<Language, BusinessCopy> = {
  en: {
    meta: {
      title: 'Formivo for business — spatial shopping for furniture',
      description: 'Formivo helps online furniture stores turn their catalogue into an interactive room-scale shopping experience.',
      shareDescription: 'Turn your furniture catalogue into interactive 3D products and help shoppers see the fit before they buy.',
    },
    skip: 'Skip to content',
    homeLabel: 'Formivo home',
    audience: 'FOR BUSINESSES',
    navigationLabel: 'Business navigation',
    nav: ['Why it works', 'How it works', 'Pilot scope'],
    customerDemo: 'Open customer demo',
    menu: { openNavigation: 'Open navigation', closeNavigation: 'Close navigation', open: 'Menu', close: 'Close' },
    hero: {
      kicker: 'FOR ONLINE FURNITURE STORES',
      titleStart: 'Let shoppers see it in',
      titleEnd: 'their room.',
      description: 'Turn your existing furniture catalogue into an interactive 3D shopping experience. Customers can draw a space, place your products at their real dimensions, and feel more confident before they buy.',
      contact: 'Contact us about a pilot',
      howLink: 'See how it works',
      note: 'WORKING PROTOTYPE · LOCAL SAMPLE CATALOGUE · NO LIVE INTEGRATIONS YET',
      imageAlt: 'Original Formivo render of a furnished room with a sofa, coffee table and warm daylight',
      viewLabel: 'THE CUSTOMER VIEW / 001',
      catalogue: 'YOUR CATALOGUE',
      artTitle: 'In their space.',
      dimensionsNote: 'Real dimensions · considered context',
      artCaption: 'AUTHORED SAMPLE GEOMETRY · SPATIAL SHOPPING STUDY',
      bottomLine: 'FROM PRODUCT PAGE TO ROOM-SCALE CONFIDENCE.',
      scrollLink: 'SCROLL TO EXPLORE',
    },
    valueProps: ['Use the catalogue you already have', 'Place products at real dimensions', 'Designed to reduce purchase uncertainty'],
    problem: {
      index: '01 / THE PROBLEM WORTH SOLVING',
      productQuestion: 'The product page answers',
      productAnswer: 'what.',
      roomQuestion: 'The room answers',
      roomAnswer: 'will it work?',
      description: 'Furniture is difficult to buy online because shoppers have to imagine scale, proportion and fit from isolated images. Formivo moves that decision into the space they are already trying to furnish.',
      caseLabel: 'THE BUSINESS CASE',
      caseTitle: 'Make confidence part of the product story.',
      caseDescription: 'The goal is straightforward: remove uncertainty from the purchase decision and give your team a clearer conversion hypothesis to test with real shoppers.',
    },
    journey: {
      index: '02 / A SIMPLE CUSTOMER JOURNEY',
      titleStart: 'From your catalogue',
      titleEnd: 'to their room.',
      description: 'One spatial layer around the catalogue you already sell. Start with the products and customer journey where context can make the biggest difference.',
      inputsLabel: 'Illustrative ways shoppers can start',
      roomDimensions: '6.00 × 4.50 m',
      layoutPhoto: 'LAYOUT PHOTO',
      drawLabel: '01 / WORKING NOW',
      drawTitle: 'Draw the space',
      drawDescription: 'Set the walls, openings and dimensions directly in the room planner.',
      photoLabel: '02 / PILOT CONCEPT',
      photoTitle: 'Upload a layout photo',
      photoDescription: 'Start from a plan or room image when drawing from scratch is not the easiest first step.',
    },
    steps: [
      { title: 'Bring the catalogue', description: 'Share the product data, dimensions, imagery, variants and permissions needed to create product-specific 3D models.', label: 'CATALOGUE SETUP' },
      { title: 'Let shoppers build a space', description: 'Customers draw a room to scale, or scope an image-based layout import as part of a focused pilot.', label: 'ROOM-SCALE INTENT' },
      { title: 'Make the fit visible', description: 'They place your sofa, bed, table or other pieces without resizing them to force a fit, then explore the arrangement in 2D and 3D.', label: 'INTERACTIVE 3D' },
      { title: 'Hand the intent back', description: 'Turn a considered room into a stronger product conversation, quote request or route back to your existing store.', label: 'YOUR COMMERCIAL FLOW' },
    ],
    pilot: {
      imageAlt: 'Original Formivo render of the Haven sample sofa with a 220 centimetre measurement',
      imageLabel: 'A PRODUCT IN CONTEXT',
      sampleNote: 'HAVEN / AUTHORED SAMPLE / 220 × 92 × 82 CM',
      sectionIndex: '03 / START WITH A FOCUSED PILOT',
      title: 'Begin where fit matters most.',
      description: 'Pick a small set of products with high consideration, build the models properly, and learn what helps your customers move from “I like it” to “it works here.”',
      steps: [
        'Choose a focused catalogue and confirm model usage rights.',
        'Agree dimensions, variants, data ownership and the handoff to your team.',
        'Test room-scale discovery beside the store journey and measure what changes.',
      ],
      contact: 'Email us about a pilot',
      emailNote: 'Opens your email app with a short proposal prompt.',
    },
    integration: {
      index: '04 / BUILT AROUND YOUR BUSINESS',
      titleStart: 'Useful before',
      titleEnd: 'it is connected.',
      description: 'Formivo is designed as a conversion layer around an existing furniture store—not a replacement for your catalogue, checkout or operational systems. Customers can browse your products in the room-scale viewer, then continue to your product, quote or checkout flow.',
      architectureLabel: 'Illustrative pilot architecture',
      catalogue: 'Your catalogue',
      catalogueDetails: 'Products · dimensions · variants',
      spatialLayer: 'Formivo spatial layer',
      spatialDetails: 'Room builder · product models · 2D / 3D',
      commercialFlow: 'Your commercial flow',
      commercialDetails: 'Store · quote · sales handoff',
      note: 'Illustrative pilot architecture. Embedding, APIs, checkout handoff, analytics and live catalogue feeds are implementation work to scope with a partner.',
    },
    faq: {
      index: 'A FEW THINGS, UP FRONT.',
      titleStart: 'Good questions.',
      titleEnd: 'Straight answers.',
      questions: [
        { question: 'Does this replace our online store?', answer: 'No. The intended role is a spatial layer around the store you already run. The exact link, embed or handoff should be agreed during a pilot.' },
        { question: 'What do you need from our catalogue?', answer: 'A focused product set, reliable dimensions, approved imagery or materials, variant information and permission to create and use the models.' },
        { question: 'Can shoppers upload a room photo?', answer: 'The working prototype supports drawing a room directly. Image-based layout import is a pilot feature to scope, not a live capability on this page.' },
        { question: 'Can you promise higher conversion?', answer: 'No uplift is claimed before measurement. The purpose of a pilot is to test whether less uncertainty creates a better customer journey and stronger commercial outcomes.' },
      ],
    },
    final: {
      topLine: 'MAKE YOUR CATALOGUE FEEL CLOSER TO HOME.',
      titleStart: 'Show the piece.',
      titleEnd: 'Sell the possibility.',
      descriptionStart: 'Start with a focused range.',
      descriptionEnd: 'Learn what the room changes.',
      contact: 'Contact us about a pilot',
      planner: 'Open the working planner',
    },
    footer: {
      description: 'Spatial shopping tools\nfor furniture businesses.',
      planner: 'Open the planner',
      backToTop: 'Back to top',
      language: 'Language',
      prototype: 'BUSINESS PROTOTYPE · PILOT CONVERSATIONS WELCOME',
    },
    emailSubject: 'Formivo B2B pilot conversation',
    emailBody: 'Hi Formivo team,\n\nI would like to discuss a Formivo pilot for:\n\nCatalogue / category:\nStore:\nProposal:\n\nBest,',
  },
  de: {
    meta: {
      title: 'Formivo für Unternehmen — räumliches Möbel-Shopping',
      description: 'Formivo macht den Möbelkatalog Ihres Onlineshops zu einem interaktiven Einkaufserlebnis im Raum.',
      shareDescription: 'Machen Sie Möbel in 3D erlebbar und zeigen Sie Ihrer Kundschaft, wie sie in den eigenen vier Wänden wirken.',
    },
    skip: 'Zum Inhalt springen',
    homeLabel: 'Formivo-Startseite',
    audience: 'FÜR UNTERNEHMEN',
    navigationLabel: 'Unternehmensnavigation',
    nav: ['Warum es funktioniert', 'So funktioniert es', 'Pilotprojekt'],
    customerDemo: 'Kundendemo öffnen',
    menu: { openNavigation: 'Navigation öffnen', closeNavigation: 'Navigation schließen', open: 'Menü', close: 'Schließen' },
    hero: {
      kicker: 'FÜR ONLINE-MÖBELHÄUSER',
      titleStart: 'Möbel direkt',
      titleEnd: 'im Raum erleben.',
      description: 'Machen Sie Ihren bestehenden Möbelkatalog zum interaktiven 3D-Einkaufserlebnis. Kundinnen und Kunden können Räume planen, Ihre Produkte maßstabsgetreu platzieren und vor dem Kauf sicherer entscheiden.',
      contact: 'Pilotprojekt besprechen',
      howLink: 'So funktioniert es',
      note: 'FUNKTIONIERENDER PROTOTYP · LOKALER MUSTERKATALOG · NOCH KEINE LIVE-INTEGRATIONEN',
      imageAlt: 'Original-Rendering von Formivo: ein eingerichteter Raum mit Sofa, Couchtisch und warmem Tageslicht',
      viewLabel: 'DIE KUNDENANSICHT / 001',
      catalogue: 'IHR KATALOG',
      artTitle: 'Im eigenen Raum.',
      dimensionsNote: 'Echte Maße · durchdachter Kontext',
      artCaption: 'ERSTELLTE MUSTERGEOMETRIE · STUDIE ZUM RÄUMLICHEN EINKAUF',
      bottomLine: 'VON DER PRODUKTSEITE ZUR SICHERHEIT IM RAUM.',
      scrollLink: 'MEHR ENTDECKEN',
    },
    valueProps: ['Nutzen Sie Ihren bestehenden Katalog', 'Platzieren Sie Produkte maßstabsgetreu', 'Weniger Unsicherheit beim Möbelkauf'],
    problem: {
      index: '01 / DAS PROBLEM, DAS WIR LÖSEN WOLLEN',
      productQuestion: 'Die Produktseite beantwortet',
      productAnswer: 'was?',
      roomQuestion: 'Der Raum zeigt:',
      roomAnswer: 'Passt es hier?',
      description: 'Möbel online zu kaufen ist schwierig: Anhand einzelner Bilder müssen Kundinnen und Kunden sich Maßstab, Proportionen und Passform vorstellen. Formivo verlagert diese Entscheidung in den Raum, den sie einrichten möchten.',
      caseLabel: 'DER GESCHÄFTLICHE MEHRWERT',
      caseTitle: 'Schaffen Sie Vertrauen – schon auf der Produktseite.',
      caseDescription: 'Das Ziel ist klar: weniger Unsicherheit bei der Kaufentscheidung und eine konkrete Hypothese, die Ihr Team mit echten Kundinnen und Kunden testen kann.',
    },
    journey: {
      index: '02 / EIN EINFACHER WEG ZUM WUNSCHRAUM',
      titleStart: 'Vom Katalog',
      titleEnd: 'in den eigenen Raum.',
      description: 'Eine räumliche Ebene für den Katalog, den Sie bereits anbieten. Beginnen Sie mit den Produkten und dem Teil der Customer Journey, bei dem der räumliche Kontext den größten Unterschied macht.',
      inputsLabel: 'So können Kundinnen und Kunden starten',
      roomDimensions: '6,00 × 4,50 m',
      layoutPhoto: 'GRUNDRISSFOTO',
      drawLabel: '01 / JETZT VERFÜGBAR',
      drawTitle: 'Raum selbst planen',
      drawDescription: 'Zeichnen Sie Wände und Öffnungen und legen Sie die Maße direkt im Raumplaner fest.',
      photoLabel: '02 / PILOTKONZEPT',
      photoTitle: 'Grundrissfoto hochladen',
      photoDescription: 'Starten Sie mit einem Grundriss oder Raumfoto, wenn eine Planung von Grund auf nicht der einfachste Einstieg ist.',
    },
    steps: [
      { title: 'Katalog bereitstellen', description: 'Teilen Sie Produktdaten, Maße, Bilder, Varianten und die nötigen Nutzungsrechte für produktspezifische 3D-Modelle.', label: 'KATALOG VORBEREITEN' },
      { title: 'Kundschaft Räume planen lassen', description: 'Kundinnen und Kunden zeichnen einen maßstabsgetreuen Raum. Ein bildbasierter Grundrissimport kann Teil eines klar abgegrenzten Pilotprojekts sein.', label: 'PLANUNG IM RAUM' },
      { title: 'Passform sichtbar machen', description: 'Sofa, Bett, Tisch und weitere Möbel lassen sich platzieren, ohne sie passend zu skalieren. Anschließend kann die Einrichtung in 2D und 3D erkundet werden.', label: 'INTERAKTIVES 3D' },
      { title: 'Kaufinteresse weitergeben', description: 'Aus einem durchdachten Raumkonzept wird ein konkretes Produktgespräch, eine Angebotsanfrage oder ein Rückweg zu Ihrem bestehenden Shop.', label: 'IHR VERTRIEBSWEG' },
    ],
    pilot: {
      imageAlt: 'Original-Rendering des Formivo-Mustersofas Haven mit einer Maßangabe von 220 Zentimetern',
      imageLabel: 'EIN PRODUKT IM RAUM',
      sampleNote: 'HAVEN / ERSTELLTES MUSTER / 220 × 92 × 82 CM',
      sectionIndex: '03 / MIT EINEM FOKUSSIERTEN PILOTPROJEKT STARTEN',
      title: 'Beginnen Sie dort, wo Passform zählt.',
      description: 'Wählen Sie einige erklärungsbedürftige Produkte, lassen Sie passende Modelle erstellen und finden Sie heraus, was Kundinnen und Kunden vom „Gefällt mir“ zu „Das passt hier“ bringt.',
      steps: [
        'Wählen Sie einen klar abgegrenzten Katalog und klären Sie die Nutzungsrechte für die Modelle.',
        'Stimmen Sie Maße, Varianten, Datenhoheit und die Übergabe an Ihr Team ab.',
        'Testen Sie die Raumplanung neben dem bestehenden Einkaufserlebnis und messen Sie die Veränderungen.',
      ],
      contact: 'Pilotprojekt per E-Mail besprechen',
      emailNote: 'Öffnet Ihr E-Mail-Programm mit einer kurzen Anfragevorlage.',
    },
    integration: {
      index: '04 / FÜR IHR UNTERNEHMEN ENTWICKELT',
      titleStart: 'Schon sinnvoll,',
      titleEnd: 'bevor alles verbunden ist.',
      description: 'Formivo ist als zusätzliche Conversion-Ebene für einen bestehenden Möbelshop gedacht – nicht als Ersatz für Katalog, Checkout oder Betriebssysteme. Kundinnen und Kunden können Möbel im Raumplaner ansehen und anschließend zu Ihrem Produkt, einer Angebotsanfrage oder dem Checkout wechseln.',
      architectureLabel: 'Beispiel für eine Pilotintegration',
      catalogue: 'Ihr Katalog',
      catalogueDetails: 'Produkte · Maße · Varianten',
      spatialLayer: 'Räumliche Formivo-Ebene',
      spatialDetails: 'Raumplaner · Produktmodelle · 2D / 3D',
      commercialFlow: 'Ihr Vertriebsweg',
      commercialDetails: 'Shop · Angebot · Vertriebsübergabe',
      note: 'Beispiel für eine Pilotintegration. Einbettung, APIs, Checkout-Übergabe, Analysen und Live-Katalogfeeds müssen gemeinsam mit einem Partner geplant und umgesetzt werden.',
    },
    faq: {
      index: 'WAS SIE VORAB WISSEN SOLLTEN',
      titleStart: 'Gute Fragen.',
      titleEnd: 'Klare Antworten.',
      questions: [
        { question: 'Ersetzt das unseren Onlineshop?', answer: 'Nein. Formivo soll Ihren bestehenden Shop um eine räumliche Ansicht ergänzen. Der konkrete Link, die Einbettung oder die Übergabe werden im Pilotprojekt vereinbart.' },
        { question: 'Was benötigen Sie aus unserem Katalog?', answer: 'Eine fokussierte Produktauswahl, verlässliche Maße, freigegebene Bilder oder Materialien, Varianteninformationen und die Erlaubnis, die Modelle zu erstellen und zu nutzen.' },
        { question: 'Können Kundinnen und Kunden ein Raumfoto hochladen?', answer: 'Im aktuellen Prototyp lässt sich ein Raum direkt zeichnen. Ein bildbasierter Grundrissimport ist ein mögliches Pilotfeature, aber auf dieser Seite noch nicht verfügbar.' },
        { question: 'Können Sie eine höhere Conversion versprechen?', answer: 'Vor einer Messung versprechen wir keine Steigerung. Im Pilotprojekt wird geprüft, ob weniger Unsicherheit das Einkaufserlebnis und die Geschäftsergebnisse verbessert.' },
      ],
    },
    final: {
      topLine: 'BRINGEN SIE IHREN KATALOG NÄHER NACH HAUSE.',
      titleStart: 'Zeigen Sie das Möbelstück.',
      titleEnd: 'Machen Sie Möglichkeiten sichtbar.',
      descriptionStart: 'Starten Sie mit einem ausgewählten Sortiment.',
      descriptionEnd: 'Finden Sie heraus, was der Raum verändert.',
      contact: 'Pilotprojekt besprechen',
      planner: 'Raumplaner ausprobieren',
    },
    footer: {
      description: 'Räumliche Einkaufserlebnisse\nfür Möbelunternehmen.',
      planner: 'Raumplaner öffnen',
      backToTop: 'Nach oben',
      language: 'Sprache',
      prototype: 'UNTERNEHMENSPROTOTYP · PILOTGESPRÄCHE WILLKOMMEN',
    },
    emailSubject: 'Formivo: Gespräch über ein B2B-Pilotprojekt',
    emailBody: 'Hallo Formivo-Team,\n\nich möchte ein Formivo-Pilotprojekt besprechen für:\n\nKatalog / Kategorie:\nGeschäft:\nVorschlag:\n\nViele Grüße,',
  },
  el: {
    meta: {
      title: 'Formivo για επιχειρήσεις — αγορές επίπλων στον χώρο',
      description: 'Η Formivo μετατρέπει τον κατάλογο ενός ηλεκτρονικού καταστήματος επίπλων σε διαδραστική εμπειρία αγορών μέσα στον χώρο.',
      shareDescription: 'Παρουσιάστε τα έπιπλά σας σε 3D και βοηθήστε τους πελάτες να δουν πώς ταιριάζουν στον χώρο τους πριν αγοράσουν.',
    },
    skip: 'Μετάβαση στο περιεχόμενο',
    homeLabel: 'Αρχική σελίδα Formivo',
    audience: 'ΓΙΑ ΕΠΙΧΕΙΡΗΣΕΙΣ',
    navigationLabel: 'Πλοήγηση για επιχειρήσεις',
    nav: ['Γιατί λειτουργεί', 'Πώς λειτουργεί', 'Πιλοτικό πρόγραμμα'],
    customerDemo: 'Άνοιγμα επίδειξης',
    menu: { openNavigation: 'Άνοιγμα πλοήγησης', closeNavigation: 'Κλείσιμο πλοήγησης', open: 'Μενού', close: 'Κλείσιμο' },
    hero: {
      kicker: 'ΓΙΑ ΗΛΕΚΤΡΟΝΙΚΑ ΚΑΤΑΣΤΗΜΑΤΑ ΕΠΙΠΛΩΝ',
      titleStart: 'Δείτε τα έπιπλα',
      titleEnd: 'στον χώρο τους.',
      description: 'Μετατρέψτε τον υπάρχοντα κατάλογό σας σε μια διαδραστική εμπειρία αγορών σε 3D. Οι πελάτες μπορούν να σχεδιάσουν τον χώρο τους, να τοποθετήσουν τα προϊόντα σας στις πραγματικές τους διαστάσεις και να αποφασίσουν με μεγαλύτερη σιγουριά πριν αγοράσουν.',
      contact: 'Επικοινωνία για πιλοτικό πρόγραμμα',
      howLink: 'Δείτε πώς λειτουργεί',
      note: 'ΛΕΙΤΟΥΡΓΙΚΟ ΠΡΩΤΟΤΥΠΟ · ΤΟΠΙΚΟΣ ΔΕΙΓΜΑΤΙΚΟΣ ΚΑΤΑΛΟΓΟΣ · ΧΩΡΙΣ ΖΩΝΤΑΝΕΣ ΔΙΑΣΥΝΔΕΣΕΙΣ',
      imageAlt: 'Πρωτότυπη απεικόνιση της Formivo: επιπλωμένος χώρος με καναπέ, τραπεζάκι και ζεστό φυσικό φως',
      viewLabel: 'Η ΕΜΠΕΙΡΙΑ ΤΟΥ ΠΕΛΑΤΗ / 001',
      catalogue: 'Ο ΚΑΤΑΛΟΓΟΣ ΣΑΣ',
      artTitle: 'Στον χώρο τους.',
      dimensionsNote: 'Πραγματικές διαστάσεις · μελετημένο πλαίσιο',
      artCaption: 'ΣΧΕΔΙΑΣΜΕΝΑ ΔΕΙΓΜΑΤΑ · ΜΕΛΕΤΗ ΑΓΟΡΩΝ ΣΤΟΝ ΧΩΡΟ',
      bottomLine: 'ΑΠΟ ΤΗ ΣΕΛΙΔΑ ΠΡΟΪΟΝΤΟΣ ΣΤΗ ΣΙΓΟΥΡΙΑ ΓΙΑ ΤΟΝ ΧΩΡΟ.',
      scrollLink: 'ΚΑΝΤΕ ΚΥΛΙΣΗ ΓΙΑ ΝΑ ΔΕΙΤΕ ΠΕΡΙΣΣΟΤΕΡΑ',
    },
    valueProps: ['Αξιοποιήστε τον κατάλογο που ήδη έχετε', 'Τοποθετήστε προϊόντα στις πραγματικές τους διαστάσεις', 'Λιγότερη αβεβαιότητα πριν από την αγορά'],
    problem: {
      index: '01 / ΤΟ ΠΡΟΒΛΗΜΑ ΠΟΥ ΑΞΙΖΕΙ ΝΑ ΛΥΘΕΙ',
      productQuestion: 'Η σελίδα προϊόντος απαντά στο',
      productAnswer: '«τι;»',
      roomQuestion: 'Ο χώρος απαντά στο',
      roomAnswer: '«ταιριάζει εδώ;»',
      description: 'Η αγορά επίπλων μέσω διαδικτύου είναι δύσκολη, επειδή οι πελάτες πρέπει να φανταστούν την κλίμακα, τις αναλογίες και την εφαρμογή τους στον χώρο βλέποντας μεμονωμένες εικόνες. Η Formivo μεταφέρει αυτή την απόφαση στον χώρο που θέλουν να επιπλώσουν.',
      caseLabel: 'ΤΟ ΟΦΕΛΟΣ ΓΙΑ ΤΗΝ ΕΠΙΧΕΙΡΗΣΗ',
      caseTitle: 'Χτίστε εμπιστοσύνη μέσα από την παρουσίαση του προϊόντος.',
      caseDescription: 'Ο στόχος είναι απλός: λιγότερη αβεβαιότητα στην απόφαση αγοράς και μια σαφής υπόθεση μετατροπής που η ομάδα σας μπορεί να δοκιμάσει με πραγματικούς πελάτες.',
    },
    journey: {
      index: '02 / ΜΙΑ ΑΠΛΗ ΔΙΑΔΡΟΜΗ ΠΕΛΑΤΗ',
      titleStart: 'Από τον κατάλογό σας',
      titleEnd: 'στον δικό τους χώρο.',
      description: 'Ένα επίπεδο χωρικής εμπειρίας γύρω από τον κατάλογο που ήδη διαθέτετε. Ξεκινήστε από τα προϊόντα και τη διαδρομή αγοράς όπου το πλαίσιο του χώρου μπορεί να κάνει τη μεγαλύτερη διαφορά.',
      inputsLabel: 'Ενδεικτικοί τρόποι για να ξεκινήσουν οι πελάτες',
      roomDimensions: '6,00 × 4,50 m',
      layoutPhoto: 'ΦΩΤΟΓΡΑΦΙΑ ΚΑΤΟΨΗΣ',
      drawLabel: '01 / ΔΙΑΘΕΣΙΜΟ ΤΩΡΑ',
      drawTitle: 'Σχεδιάστε τον χώρο',
      drawDescription: 'Ορίστε τοίχους, ανοίγματα και διαστάσεις απευθείας στην εφαρμογή σχεδιασμού χώρου.',
      photoLabel: '02 / ΙΔΕΑ ΓΙΑ ΠΙΛΟΤΙΚΟ ΠΡΟΓΡΑΜΜΑ',
      photoTitle: 'Ανεβάστε φωτογραφία κάτοψης',
      photoDescription: 'Ξεκινήστε από μια κάτοψη ή φωτογραφία του χώρου, αν ο σχεδιασμός από την αρχή δεν είναι το πιο εύκολο πρώτο βήμα.',
    },
    steps: [
      { title: 'Προσθέστε τον κατάλογο', description: 'Μοιραστείτε τα δεδομένα, τις διαστάσεις, τις εικόνες, τις παραλλαγές και τις άδειες χρήσης που χρειάζονται για τη δημιουργία ειδικών τρισδιάστατων μοντέλων.', label: 'ΠΡΟΕΤΟΙΜΑΣΙΑ ΚΑΤΑΛΟΓΟΥ' },
      { title: 'Αφήστε τους πελάτες να σχεδιάσουν', description: 'Οι πελάτες σχεδιάζουν έναν χώρο σε κλίμακα. Η εισαγωγή κάτοψης από εικόνα μπορεί να εξεταστεί στο πλαίσιο ενός στοχευμένου πιλοτικού προγράμματος.', label: 'ΣΧΕΔΙΑΣΜΟΣ ΣΕ ΚΛΙΜΑΚΑ' },
      { title: 'Κάντε την εφαρμογή ορατή', description: 'Τοποθετούν καναπέδες, κρεβάτια και τραπέζια χωρίς να αλλάζουν τις διαστάσεις τους για να χωρέσουν, και εξερευνούν τη διάταξη σε 2D και 3D.', label: 'ΔΙΑΔΡΑΣΤΙΚΟ 3D' },
      { title: 'Συνεχίστε τη διαδρομή αγοράς', description: 'Μετατρέψτε έναν μελετημένο χώρο σε ουσιαστικότερη συζήτηση για το προϊόν, αίτημα προσφοράς ή επιστροφή στο υπάρχον κατάστημά σας.', label: 'Η ΕΜΠΟΡΙΚΗ ΣΑΣ ΡΟΗ' },
    ],
    pilot: {
      imageAlt: 'Πρωτότυπη απεικόνιση του καναπέ Haven της Formivo με ένδειξη μήκους 220 εκατοστών',
      imageLabel: 'ΕΝΑ ΠΡΟΪΟΝ ΣΤΟΝ ΧΩΡΟ',
      sampleNote: 'HAVEN / ΣΧΕΔΙΑΣΜΕΝΟ ΔΕΙΓΜΑ / 220 × 92 × 82 CM',
      sectionIndex: '03 / ΞΕΚΙΝΗΣΤΕ ΜΕ ΕΝΑ ΣΤΟΧΕΥΜΕΝΟ ΠΙΛΟΤΙΚΟ ΠΡΟΓΡΑΜΜΑ',
      title: 'Ξεκινήστε από εκεί όπου η εφαρμογή μετρά περισσότερο.',
      description: 'Επιλέξτε λίγα προϊόντα που απαιτούν προσεκτική εξέταση, δημιουργήστε σωστά τα μοντέλα και ανακαλύψτε τι βοηθά τους πελάτες να περάσουν από το «μου αρέσει» στο «ταιριάζει εδώ».',
      steps: [
        'Επιλέξτε έναν στοχευμένο κατάλογο και επιβεβαιώστε τα δικαιώματα χρήσης των μοντέλων.',
        'Συμφωνήστε για διαστάσεις, παραλλαγές, κυριότητα δεδομένων και τον τρόπο παράδοσης στην ομάδα σας.',
        'Δοκιμάστε την αναζήτηση σε κλίμακα χώρου παράλληλα με τη διαδρομή του καταστήματος και μετρήστε τις αλλαγές.',
      ],
      contact: 'Στείλτε μας email για πιλοτικό πρόγραμμα',
      emailNote: 'Ανοίγει την εφαρμογή email με ένα σύντομο πρότυπο πρότασης.',
    },
    integration: {
      index: '04 / ΣΧΕΔΙΑΣΜΕΝΟ ΓΙΑ ΤΗΝ ΕΠΙΧΕΙΡΗΣΗ ΣΑΣ',
      titleStart: 'Χρήσιμο πριν',
      titleEnd: 'συνδεθεί με τα συστήματά σας.',
      description: 'Η Formivo σχεδιάζεται ως ένα επιπλέον επίπεδο αγορών για ένα υπάρχον κατάστημα επίπλων — όχι ως αντικατάσταση του καταλόγου, του ταμείου ή των λειτουργικών συστημάτων σας. Οι πελάτες εξερευνούν τα προϊόντα στον χώρο και συνεχίζουν στη σελίδα προϊόντος, στην αίτηση προσφοράς ή στη διαδικασία αγοράς σας.',
      architectureLabel: 'Ενδεικτική δομή πιλοτικού προγράμματος',
      catalogue: 'Ο κατάλογός σας',
      catalogueDetails: 'Προϊόντα · διαστάσεις · παραλλαγές',
      spatialLayer: 'Χωρική εμπειρία Formivo',
      spatialDetails: 'Σχεδιασμός χώρου · μοντέλα · 2D / 3D',
      commercialFlow: 'Η εμπορική σας ροή',
      commercialDetails: 'Κατάστημα · προσφορά · συνέχεια πωλήσεων',
      note: 'Ενδεικτική δομή πιλοτικού προγράμματος. Η ενσωμάτωση, τα API, η σύνδεση με τη διαδικασία αγοράς, τα αναλυτικά στοιχεία και οι ζωντανοί κατάλογοι χρειάζονται σχεδιασμό με συνεργάτη.',
    },
    faq: {
      index: 'ΜΕΡΙΚΕΣ ΑΠΑΝΤΗΣΕΙΣ ΑΠΟ ΤΗΝ ΑΡΧΗ',
      titleStart: 'Εύλογες ερωτήσεις.',
      titleEnd: 'Ειλικρινείς απαντήσεις.',
      questions: [
        { question: 'Αντικαθιστά το ηλεκτρονικό μας κατάστημα;', answer: 'Όχι. Στόχος είναι να προστεθεί μια χωρική εμπειρία γύρω από το κατάστημα που ήδη λειτουργείτε. Ο ακριβής σύνδεσμος, η ενσωμάτωση ή η μετάβαση συμφωνούνται στο πιλοτικό πρόγραμμα.' },
        { question: 'Τι χρειάζεστε από τον κατάλογό μας;', answer: 'Μια στοχευμένη ομάδα προϊόντων, αξιόπιστες διαστάσεις, εγκεκριμένες εικόνες ή υλικά, πληροφορίες παραλλαγών και άδεια δημιουργίας και χρήσης των μοντέλων.' },
        { question: 'Μπορούν οι πελάτες να ανεβάσουν φωτογραφία του χώρου;', answer: 'Το λειτουργικό πρωτότυπο υποστηρίζει τον άμεσο σχεδιασμό χώρου. Η εισαγωγή διάταξης από εικόνα είναι πιθανό χαρακτηριστικό πιλοτικού προγράμματος και δεν είναι ακόμη διαθέσιμη εδώ.' },
        { question: 'Μπορείτε να εγγυηθείτε αύξηση των πωλήσεων;', answer: 'Δεν υποσχόμαστε αύξηση πριν από τη μέτρηση. Το πιλοτικό πρόγραμμα εξετάζει αν η μείωση της αβεβαιότητας βελτιώνει την εμπειρία αγοράς και τα εμπορικά αποτελέσματα.' },
      ],
    },
    final: {
      topLine: 'ΦΕΡΤΕ ΤΟΝ ΚΑΤΑΛΟΓΟ ΣΑΣ ΠΙΟ ΚΟΝΤΑ ΣΤΟΝ ΧΩΡΟ.',
      titleStart: 'Δείξτε το έπιπλο.',
      titleEnd: 'Αναδείξτε τις δυνατότητές του.',
      descriptionStart: 'Ξεκινήστε με μια μικρή, επιλεγμένη σειρά.',
      descriptionEnd: 'Δείτε τι αλλάζει όταν μπαίνει στον χώρο.',
      contact: 'Επικοινωνία για πιλοτικό πρόγραμμα',
      planner: 'Άνοιγμα εφαρμογής σχεδιασμού',
    },
    footer: {
      description: 'Εργαλεία χωρικών αγορών\nγια επιχειρήσεις επίπλων.',
      planner: 'Άνοιγμα εφαρμογής σχεδιασμού',
      backToTop: 'Επιστροφή στην κορυφή',
      language: 'Γλώσσα',
      prototype: 'ΠΡΩΤΟΤΥΠΟ ΓΙΑ ΕΠΙΧΕΙΡΗΣΕΙΣ · ΕΥΠΡΟΣΔΕΚΤΕΣ ΟΙ ΣΥΖΗΤΗΣΕΙΣ ΓΙΑ ΠΙΛΟΤΙΚΟ ΠΡΟΓΡΑΜΜΑ',
    },
    emailSubject: 'Formivo: συζήτηση για πιλοτική συνεργασία B2B',
    emailBody: 'Γεια σας, ομάδα Formivo,\n\nΘα ήθελα να συζητήσουμε ένα πιλοτικό πρόγραμμα της Formivo για:\n\nΚατάλογος / κατηγορία:\nΚατάστημα:\nΠρόταση:\n\nΜε εκτίμηση,',
  },
}

const businessEmail = 'info@formivo3d.com'
const languageStorageKey = 'formivo-language'
const languageOptions: [Language, string][] = [['en', 'English'], ['de', 'Deutsch'], ['el', 'Ελληνικά']]
const Arrow = ({ diagonal = false }: { diagonal?: boolean }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h15m-6-6 6 6-6 6'} /></svg>

function getSavedLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(languageStorageKey)
    return saved === 'de' || saved === 'el' ? saved : 'en'
  } catch {
    return 'en'
  }
}

export default function Business() {
  const [language, setLanguage] = useState<Language>(getSavedLanguage)
  const [menuOpen, setMenuOpen] = useState(false)
  const copy = translations[language]
  const closeMenu = () => setMenuOpen(false)
  const contactHref = `mailto:${businessEmail}?subject=${encodeURIComponent(copy.emailSubject)}&body=${encodeURIComponent(copy.emailBody)}`

  useEffect(() => {
    document.documentElement.lang = language
    document.title = copy.meta.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', copy.meta.description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', copy.meta.title)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', copy.meta.shareDescription)
    try { window.localStorage.setItem(languageStorageKey, language) } catch {}
  }, [copy, language])

  return <div className="showcase b2b">
    <a className="s-skip" href="#main">{copy.skip}</a>
    <header className="s-header b2b-header">
      <a className="s-wordmark" href="/" aria-label={copy.homeLabel}>formivo<span aria-hidden="true">✳</span></a>
      <span className="b2b-audience">{copy.audience}</span>
      <nav className={menuOpen ? 's-nav s-nav-open' : 's-nav'} aria-label={copy.navigationLabel}>
        <a href="#why" onClick={closeMenu}>{copy.nav[0]}</a>
        <a href="#flow" onClick={closeMenu}>{copy.nav[1]}</a>
        <a href="#pilot" onClick={closeMenu}>{copy.nav[2]}</a>
      </nav>
      <a href="/planner" className="s-header-cta b2b-header-demo">{copy.customerDemo} <Arrow diagonal /></a>
      <button className="s-menu-toggle" aria-label={menuOpen ? copy.menu.closeNavigation : copy.menu.openNavigation} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? copy.menu.close : copy.menu.open} <span aria-hidden="true">{menuOpen ? '×' : '+'}</span></button>
    </header>

    <main id="main">
      <section className="b2b-hero" aria-labelledby="business-heading">
        <div className="b2b-hero-copy">
          <span className="s-kicker"><span className="s-dot" /> {copy.hero.kicker}</span>
          <h1 id="business-heading">{copy.hero.titleStart} <em>{copy.hero.titleEnd}</em></h1>
          <p>{copy.hero.description}</p>
          <div className="b2b-hero-actions"><a className="s-button s-button-dark" href={contactHref}>{copy.hero.contact} <Arrow diagonal /></a><a className="s-text-link" href="#flow">{copy.hero.howLink} <Arrow /></a></div>
          <span className="b2b-hero-note">{copy.hero.note}</span>
        </div>
        <div className="b2b-hero-art">
          <img src="/showcase-room.jpg" alt={copy.hero.imageAlt} width="1400" height="1250" fetchPriority="high" />
          <span className="b2b-art-index">{copy.hero.viewLabel}</span>
          <div className="b2b-art-card"><span>{copy.hero.catalogue}</span><strong>{copy.hero.artTitle}</strong><small>{copy.hero.dimensionsNote}</small></div>
          <span className="b2b-art-caption">{copy.hero.artCaption}</span>
        </div>
        <div className="b2b-hero-bottom"><span>{copy.hero.bottomLine}</span><a href="#why">{copy.hero.scrollLink} <span aria-hidden="true">↓</span></a></div>
      </section>

      <div className="b2b-value-strip"><span>{copy.valueProps[0]}</span><span aria-hidden="true">✳</span><span>{copy.valueProps[1]}</span><span aria-hidden="true">✳</span><span>{copy.valueProps[2]}</span></div>

      <section className="b2b-section b2b-why" id="why">
        <div className="b2b-section-index">{copy.problem.index}</div>
        <div className="b2b-why-main"><h2>{copy.problem.productQuestion} <em>{copy.problem.productAnswer}</em><br />{copy.problem.roomQuestion} <em>{copy.problem.roomAnswer}</em></h2><p>{copy.problem.description}</p></div>
        <div className="b2b-business-case"><span>{copy.problem.caseLabel}</span><strong>{copy.problem.caseTitle}</strong><p>{copy.problem.caseDescription}</p></div>
      </section>

      <section className="b2b-section b2b-flow" id="flow">
        <div className="b2b-heading"><div><div className="b2b-section-index">{copy.journey.index}</div><h2>{copy.journey.titleStart}<br /><em>{copy.journey.titleEnd}</em></h2></div><p>{copy.journey.description}</p></div>
        <div className="b2b-space-inputs" aria-label={copy.journey.inputsLabel}>
          <div className="b2b-space-option"><div className="b2b-space-preview b2b-space-draw" aria-hidden="true"><svg viewBox="0 0 260 145" fill="none"><rect x="35" y="22" width="190" height="101" stroke="currentColor" strokeWidth="3" /><path d="M35 89h33V55h47v34h110M115 22v33M181 22v22" stroke="currentColor" strokeWidth="3" /><rect x="79" y="63" width="57" height="18" rx="3" fill="currentColor" opacity=".3" /><circle cx="171" cy="83" r="12" fill="currentColor" opacity=".3" /></svg><span>{copy.journey.roomDimensions}</span></div><div><span>{copy.journey.drawLabel}</span><strong>{copy.journey.drawTitle}</strong><p>{copy.journey.drawDescription}</p></div></div>
          <div className="b2b-space-option"><div className="b2b-space-preview b2b-space-photo" aria-hidden="true"><div className="b2b-photo-sheet"><span>{copy.journey.layoutPhoto}</span><i /><i /><i /><b>+</b></div></div><div><span>{copy.journey.photoLabel}</span><strong>{copy.journey.photoTitle}</strong><p>{copy.journey.photoDescription}</p></div></div>
        </div>
        <ol className="b2b-steps">
          {copy.steps.map((step, index) => <li key={step.title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{step.title}</h3><p>{step.description}</p><small>{step.label}</small></li>)}
        </ol>
      </section>

      <section className="b2b-pilot" id="pilot">
        <div className="b2b-pilot-visual"><img src="/showcase-sofa-haven.jpg" alt={copy.pilot.imageAlt} width="900" height="720" /><span className="b2b-pilot-label">{copy.pilot.imageLabel}</span><div className="b2b-measure"><span />220 CM<span /></div><span className="b2b-pilot-note">{copy.pilot.sampleNote}</span></div>
        <div className="b2b-pilot-copy"><span className="b2b-section-index">{copy.pilot.sectionIndex}</span><h2>{copy.pilot.title}</h2><p>{copy.pilot.description}</p><ul>{copy.pilot.steps.map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><span>{step}</span></li>)}</ul><a className="s-button s-button-acid" href={contactHref}>{copy.pilot.contact} <Arrow diagonal /></a><small>{copy.pilot.emailNote}</small></div>
      </section>

      <section className="b2b-section b2b-stack" id="integration">
        <div className="b2b-heading"><div><div className="b2b-section-index">{copy.integration.index}</div><h2>{copy.integration.titleStart}<br /><em>{copy.integration.titleEnd}</em></h2></div><p>{copy.integration.description}</p></div>
        <div className="b2b-architecture" aria-label={copy.integration.architectureLabel}><div><span>01</span><strong>{copy.integration.catalogue}</strong><small>{copy.integration.catalogueDetails}</small></div><b aria-hidden="true">+</b><div className="b2b-architecture-highlight"><span>02</span><strong>{copy.integration.spatialLayer}</strong><small>{copy.integration.spatialDetails}</small></div><b aria-hidden="true">→</b><div><span>03</span><strong>{copy.integration.commercialFlow}</strong><small>{copy.integration.commercialDetails}</small></div></div>
        <p className="b2b-architecture-note">{copy.integration.note}</p>
      </section>

      <section className="b2b-faq b2b-section">
        <div><div className="b2b-section-index">{copy.faq.index}</div><h2>{copy.faq.titleStart}<br /><em>{copy.faq.titleEnd}</em></h2></div>
        <div>{copy.faq.questions.map(({ question, answer }) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="b2b-final"><div className="b2b-final-top"><span className="b2b-section-index">{copy.final.topLine}</span><span aria-hidden="true">↙</span></div><h2>{copy.final.titleStart}<br /><em>{copy.final.titleEnd}</em></h2><div className="b2b-final-bottom"><p>{copy.final.descriptionStart}<br />{copy.final.descriptionEnd}</p><div><a className="s-button s-button-dark" href={contactHref}>{copy.final.contact} <Arrow diagonal /></a><a className="s-text-link" href="/planner">{copy.final.planner} <Arrow /></a></div></div></section>
    </main>

    <footer className="b2b-footer"><a className="s-wordmark" href="/" aria-label={copy.homeLabel}>formivo<span aria-hidden="true">✳</span></a><p>{copy.footer.description.split('\n').map((line, index, lines) => <span key={line}>{line}{index < lines.length - 1 && <br />}</span>)}</p><div><a href="/planner">{copy.footer.planner} <span aria-hidden="true">↗</span></a><a href="#main">{copy.footer.backToTop} <span aria-hidden="true">↑</span></a><label className="b2b-language-picker" htmlFor="business-language"><span>{copy.footer.language}</span><select id="business-language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>{languageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="b2b-footer-base"><span>© {new Date().getFullYear()} FORMIVO</span><span>{copy.footer.prototype}</span></div></footer>
  </div>
}
