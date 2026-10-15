/* ============================================================
   Rapid Task — сторінка донату.
   ЗАМІНИ посилання нижче на свої реальні (PayPal.me, Payoneer, банка monobank).
   ============================================================ */
const DONATE_LINKS = {
  paypal:   "https://www.paypal.me/Rostyslav Syniavskyi",
  payoneer: "https://link.payoneer.com/YOUR_PAYONEER_LINK",
  monobank: "https://send.monobank.ua/jar/YOUR_JAR_ID",
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-pay]").forEach(a => {
    a.href = DONATE_LINKS[a.dataset.pay] || "#";
  });
});
