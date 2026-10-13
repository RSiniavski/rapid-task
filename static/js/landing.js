/* ============================================================
   Rapid Task — логіка landing-сторінки
   Модальне вікно авторизації: логін / реєстрація.
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // якщо користувач вже залогінений — ведемо на дашборд
  if (API.token()) {
    API.me()
      .then(() => { location.href = "/dashboard.html"; })
      .catch(() => API.setToken(null)); // токен протух — лишаємось на landing
  }

  const backdrop = document.getElementById("auth-backdrop");
  const modal = backdrop.querySelector(".modal");
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const formLogin = document.getElementById("form-login");
  const formRegister = document.getElementById("form-register");
  const loginError = document.getElementById("login-error");
  const registerError = document.getElementById("register-error");

  function openModal(tab = "login") {
    switchTab(tab);
    loginError.textContent = "";
    registerError.textContent = "";
    backdrop.classList.add("open");
    modal.querySelector("input:not([type='hidden'])")?.focus();
  }

  function closeModal() {
    backdrop.classList.remove("open");
  }

  function switchTab(tab) {
    const isLogin = tab === "login";
    tabLogin.classList.toggle("active", isLogin);
    tabRegister.classList.toggle("active", !isLogin);
    formLogin.style.display = isLogin ? "" : "none";
    formRegister.style.display = isLogin ? "none" : "";
  }

  // відкриття
  document.querySelectorAll("[data-open-auth]").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.openAuth));
  });

  // закриття: хрестик, клік по фону, Escape
  document.getElementById("auth-close").addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  tabLogin.addEventListener("click", () => switchTab("login"));
  tabRegister.addEventListener("click", () => switchTab("register"));

  // --- Логін ---
  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    const email = formLogin.email.value.trim();
    const password = formLogin.password.value;

    const btn = formLogin.querySelector("button[type='submit']");
    btn.disabled = true;
    try {
      const token = await API.login(email, password);
      API.setToken(token.access_token);
      location.href = "/dashboard.html";
    } catch (err) {
      loginError.textContent = `${i18nGet("auth.error")}: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // --- Реєстрація ---
  formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    registerError.textContent = "";
    const full_name = formRegister.full_name.value.trim();
    const email = formRegister.email.value.trim();
    const password = formRegister.password.value;

    const btn = formRegister.querySelector("button[type='submit']");
    btn.disabled = true;
    try {
      await API.register(full_name, email, password);
      // після реєстрації одразу логінимо
      const token = await API.login(email, password);
      API.setToken(token.access_token);
      location.href = "/dashboard.html";
    } catch (err) {
      registerError.textContent = `${i18nGet("auth.error")}: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
});
