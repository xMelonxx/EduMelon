# Dokumentacja Projektu: Moduł „Testy” EduMelon (Dark Mode)

## 1. System Komponentów
*   **Cards (Karty):** Zaokrąglenie 24px, półprzezroczyste tło (glassmorphism), delikatna ramka (1px) dla separacji.
*   **Buttons (Przyciski):** 
    *   Primary: Gradient medyczny (Deep Teal to Emerald), zaokrąglenie full.
    *   Secondary: Konturowe z efektem hover (glow).
    *   ABCD: Wielkie kafle, stan 'selected' z wyraźnym akcentem kolorystycznym.
*   **Badges (Etykiety):** Małe, z dużym kontrastem, kolory semantyczne (Success: Green, Error: Red, Info: Blue).
*   **Progress Bar:** Cienki, elegancki pasek na górze ekranu z animowanym przejściem.
*   **Chart Container:** Donut chart z animacją ładowania wyniku.

## 2. Struktura Layoutu
*   **TestyHub:** Grid 3-kolumnowy na desktopie, przejrzysty nagłówek z wyszukiwarką.
*   **Rozwiązywanie:** Centralny focus mode. Lewa strona: Treść pytania i obrazek. Prawa strona: Opcje ABCD.
*   **Wynik:** Hero section z dużym wykresem na górze, poniżej scrollowalna lista błędnych odpowiedzi.

## 3. Stany Interakcji
*   **Hover:** Delikatne podświetlenie tła i uniesienie karty (shadow shift).
*   **Active:** Skala 0.98 dla przycisków.
*   **Loading:** Skeleton screens dla kart prezentacji.
*   **Disabled:** Opacity 40% z kursorem 'not-allowed'.

## 4. Tokeny UI
*   **Spacing:** 8px base (4, 8, 16, 24, 32, 48, 64).
*   **Radius:** 16px (małe elementy), 24px (karty), full (przyciski).
*   **Typography:** Nagłówki: Plus Jakarta Sans (Bold), Body: Inter (Regular/Medium) dla maksymalnej czytelności.
*   **Colors:**
    *   Background: #0A0F0D (Deep Midnight)
    *   Surface: #141B18 (Dark Emerald)
    *   Primary: #4ADE80 (Bright Melon)
    *   Error: #FB7185 (Soft Rose)

## 5. Wersja „High Readability”
Dla bardzo długich pytań medycznych wprowadzamy:
*   Zwiększony line-height (1.6).
*   Możliwość powiększenia obrazka/diagramu do trybu pełnoekranowego.
*   Maksymalna szerokość kontenera tekstu: 800px.