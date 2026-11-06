/* ============================================================
   Modal guard — a window closes on a click on the dark background only when the mouse button
   was pressed AND released on the background (both). Selecting text in a field and letting the
   button go outside the window does not close it any more.
   One small capture listener for every page (the dialogs keep their own @click.self code).
   ============================================================ */
(function () {
  let pressed = null;                       // where the last mouse button went down
  let released = null;                      // where it came up
  document.addEventListener("mousedown", (e) => { pressed = e.target; released = null; }, true);
  document.addEventListener("mouseup", (e) => { released = e.target; }, true);
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains("modal-backdrop") && (pressed !== t || released !== t)) {
      e.stopPropagation();                  // the press or the release was inside the window: not a "click outside"
      e.stopImmediatePropagation();
    }
    pressed = null; released = null;
  }, true);
})();
