// Formato de fechas y números: la interfaz está en español, así que se usa el español del navegador
// (es-MX, es-ES, es-AR…) y, si el navegador está en otro idioma, español genérico.
export const LOCALE: string =
  (typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [])
    .find((l) => /^es\b/i.test(l || "")) || "es";
