/* Intolerancias · js/data.js
 * Constantes de dominio: ventanas típicas de aparición por ingrediente
 * (SOLO ORIENTATIVAS, no diagnósticas), síntomas y keywords del análisis local. */
(function () {
  "use strict";

  // Ventana típica de aparición de síntomas tras la ingesta.
  // Valores orientativos divulgativos; cada persona varía.
  // startH/endH en horas.
  const ONSET_WINDOWS = {
    lactosa:      { label: "Lactosa",       startH: 0.5, endH: 2,  hint: "lácteos: leche, queso, yogur, mantequilla" },
    gluten:       { label: "Gluten",        startH: 1,   endH: 48, hint: "trigo, cebada, centeno: pan, pasta, cerveza" },
    fructosa:     { label: "Fructosa",      startH: 1,   endH: 4,  hint: "miel, manzana, pera, refrescos, zumos" },
    huevo:        { label: "Huevo",         startH: 1,   endH: 6,  hint: "huevo, tortilla, rebozados" },
    frutosSecos:  { label: "Frutos secos",  startH: 0.25, endH: 2, hint: "nuez, almendra, avellana, cacahuete" },
    soja:         { label: "Soja",          startH: 1,   endH: 6,  hint: "soja, tofu, salsa de soja" },
    picante:      { label: "Picante / grasa", startH: 0.5, endH: 3, hint: "fritos, picante, comidas muy grasas" },
    alcohol:      { label: "Alcohol",       startH: 1,   endH: 12, hint: "cerveza, vino, destilados" },
    cafeina:      { label: "Cafeína",       startH: 0.5, endH: 6,  hint: "café, té, energéticas, chocolate" },
    histamina:    { label: "Histamina",     startH: 0.5, endH: 2,  hint: "embutidos curados, queso curado, vino tinto, conservas" }
  };

  const SYMPTOMS = [
    "hinchazón", "gases", "dolor abdominal", "diarrea", "náusea",
    "acidez", "cansancio", "dolor de cabeza", "erupción", "estreñimiento", "otro"
  ];

  // Keywords (minúsculas, sin tildes) → ingrediente, para el análisis local sin IA.
  const KEYWORDS = [
    [/lech|queso|yogur|mantequilla|nata|batido|lacteo|pizza|helado/, "lactosa"],
    [/pan|pasta|trigo|gluten|harina|cerveza|pizza|pasta|boll|galleta|croissant|empanada|rebozado/, "gluten"],
    [/miel|manzana|pera|zumo|refresco|fructosa|mango|chucher/, "fructosa"],
    [/huevo|tortilla|mayonesa/, "huevo"],
    [/nuez|almendra|avellana|cacahuete|pistacho|frutos secos/, "frutosSecos"],
    [/soja|tofu|sushi/, "soja"],
    [/picante|frito|grasa|hamburguesa|kebab|chili/, "picante"],
    [/cerveza|vino|alcohol|copa|birra/, "alcohol"],
    [/cafe|chocolate|energetica|te\b/, "cafeina"],
    [/embutido|chorizo|jamon|queso curado|conserva|atun en lata/, "histamina"]
  ];

  const DISCLAIMER = "Orientativo, no médico: no diagnostica intolerancias ni sustituye una prueba médica real con un profesional sanitario.";

  const DEFAULT_MODEL = "claude-sonnet-4-20250514";

  window.IntolData = { ONSET_WINDOWS, SYMPTOMS, KEYWORDS, DISCLAIMER, DEFAULT_MODEL };
})();
