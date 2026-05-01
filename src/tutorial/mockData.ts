export const demoPdfPages = [
  {
    page: 1,
    title: "Wprowadzenie do fotosyntezy",
    content:
      "Fotosynteza to proces, w ktorym rosliny, glony i niektore bakterie przeksztalcaja energie swiatla w energie chemiczna. Zachodzi glownie w chloroplastach. Substratami sa dwutlenek wegla i woda, a produktami glukoza i tlen.",
  },
  {
    page: 2,
    title: "Etapy procesu",
    content:
      "W fazie jasnej energia swiatla jest wykorzystywana do syntezy ATP i NADPH. W fazie ciemnej (cykl Calvina) dwutlenek wegla jest laczony i redukowany do zwiazkow organicznych. Chlorofil absorbuje swiatlo glownie z zakresu czerwonego i niebieskiego.",
  },
  {
    page: 3,
    title: "Porownanie z oddychaniem komorkowym",
    content:
      "Fotosynteza magazynuje energie wiazaniach chemicznych, a oddychanie komorkowe uwalnia te energie. Procesy sa komplementarne: produkty jednego stanowia substraty drugiego. Tempo fotosyntezy zalezy od natezenia swiatla, temperatury i stezenia CO2.",
  },
];

export const demoChatPrompts = [
  {
    question: "Jaka jest rola chlorofilu?",
    answer:
      "Chlorofil pochlania energie swiatla, glownie z zakresu czerwonego i niebieskiego. Ta energia napedza reakcje fazy jasnej, ktore prowadza do powstania ATP i NADPH potrzebnych do syntezy zwiazkow organicznych.",
  },
  {
    question: "Czym rozni sie fotosynteza od oddychania komorkowego?",
    answer:
      "Fotosynteza magazynuje energie w czasteczkach organicznych, wykorzystujac swiatlo, CO2 i wode. Oddychanie komorkowe robi odwrotnie: rozklada zwiazki organiczne i uwalnia energie potrzebna komorce.",
  },
  {
    question: "Podaj 2 czynniki wplywajace na tempo fotosyntezy.",
    answer:
      "Tempo fotosyntezy silnie zalezy od natezenia swiatla i stezenia dwutlenku wegla. Dodatkowo istotna jest temperatura, bo wplywa na aktywnosc enzymow.",
  },
];

export const demoFlashcards = [
  { front: "Fotosynteza", back: "Proces syntezy zwiazkow organicznych z CO2 i H2O przy udziale swiatla." },
  { front: "Chlorofil", back: "Barwnik pochlaniajacy swiatlo i rozpoczynajacy faze jasna fotosyntezy." },
  { front: "Faza jasna", back: "Etap fotosyntezy, w ktorym powstaja ATP i NADPH.", difficult: true },
  { front: "Cykl Calvina", back: "Etap asymilacji CO2 i syntezy zwiazkow organicznych." },
  { front: "ATP", back: "Uniwersalny nosnik energii chemicznej w komorce." },
  { front: "Oddychanie komorkowe", back: "Proces uwalniania energii z glukozy w komorce.", difficult: true },
];

export const demoTestQuestions = [
  {
    question: "Ktory barwnik bezposrednio uczestniczy w pochlanianiu swiatla podczas fotosyntezy?",
    options: ["Karoten", "Ksantofil", "Chlorofil", "Hemoglobina"],
    correct: 2,
    explanation: "To chlorofil pochlania swiatlo i inicjuje reakcje fazy jasnej.",
  },
  {
    question: "Co jest bezposrednim produktem fazy jasnej?",
    options: ["Glukoza i tlen", "ATP i NADPH", "CO2 i H2O", "Skrobia i celuloza"],
    correct: 1,
    explanation: "W fazie jasnej powstaja ATP i NADPH wykorzystywane potem w cyklu Calvina.",
  },
  {
    question: "Ktore zdanie najlepiej opisuje relacje fotosyntezy i oddychania komorkowego?",
    options: [
      "To ten sam proces pod inna nazwa",
      "Procesy sa niezalezne od siebie",
      "Produkty jednego sa substratami drugiego",
      "Oba procesy zachodza tylko w mitochondriach",
    ],
    correct: 2,
    explanation: "Fotosynteza i oddychanie sa procesami komplementarnymi.",
  },
  {
    question: "Ktory czynnik nie wplywa bezposrednio na tempo fotosyntezy?",
    options: ["Natezenie swiatla", "Stezenie CO2", "Temperatura", "Grupa krwi rosliny"],
    correct: 3,
    explanation: "Grupa krwi nie dotyczy roslin i nie ma znaczenia dla fotosyntezy.",
  },
];

export const demoGenerationTimeline = [0, 35, 70, 100];
