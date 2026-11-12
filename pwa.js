/* MD20 WMS PWA installer + service worker registration */
(function () {
  "use strict";

  const isSecureContextForPWA =
    location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (!isSecureContextForPWA) {
    console.warn("MD20 PWA requires HTTPS (or localhost) for installation.");
    return;
  }

  // Register the worker from the project root so it controls the whole app.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js", { scope: "./" })
        .then(function (registration) {
          console.log("MD20 PWA service worker ready:", registration.scope);
          registration.update().catch(function () {});
        })
        .catch(function (error) {
          console.error("MD20 PWA service worker registration failed:", error);
        });
    });
  }

  let deferredInstallPrompt = null;
  let installButton = null;

  function createInstallButton() {
    if (installButton || document.getElementById("md20InstallApp")) return;

    installButton = document.createElement("button");
    installButton.id = "md20InstallApp";
    installButton.type = "button";
    installButton.className = "md20-install-btn";
    installButton.setAttribute("aria-label", "Install MD20 app");
    installButton.innerHTML = '<span class="md20-install-icon">↓</span><span>Install App</span>';

    installButton.addEventListener("click", async function () {
      // Android/Desktop Chromium install prompt.
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === "accepted") hideInstallButton();
        deferredInstallPrompt = null;
        return;
      }

      // iPhone/iPad: Safari exposes no programmatic install prompt.
      if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        showInstallHelp("iPhone / iPad", "Safari mein Share button dabayein, phir “Add to Home Screen” select karein.");
        return;
      }

      // Browser may already be in standalone mode or may not support install prompts.
      showInstallHelp("Install MD20", "Browser menu (⋮) kholein aur “Install app” ya “Add to Home Screen” select karein. Chrome/Edge mein website HTTPS par open honi chahiye.");
    });

    const shellRight = document.querySelector("#shellBar .shell-right");
    if (shellRight) {
      shellRight.insertBefore(installButton, shellRight.firstChild);
    } else {
      document.body.appendChild(installButton);
    }
  }

  function hideInstallButton() {
    if (installButton) installButton.classList.add("md20-install-hidden");
  }

  function showInstallHelp(title, message) {
    let box = document.getElementById("md20InstallHelp");
    if (!box) {
      box = document.createElement("div");
      box.id = "md20InstallHelp";
      box.className = "md20-install-help";
      box.innerHTML = '<div class="md20-install-help-card"><button type="button" class="md20-install-help-close" aria-label="Close">×</button><strong class="md20-install-help-title"></strong><p class="md20-install-help-message"></p></div>';
      document.body.appendChild(box);
      box.querySelector(".md20-install-help-close").addEventListener("click", () => box.classList.remove("open"));
      box.addEventListener("click", (event) => {
        if (event.target === box) box.classList.remove("open");
      });
    }
    box.querySelector(".md20-install-help-title").textContent = title;
    box.querySelector(".md20-install-help-message").textContent = message;
    box.classList.add("open");
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    createInstallButton();
  });

  window.addEventListener("appinstalled", function () {
    hideInstallButton();
    deferredInstallPrompt = null;
    console.log("MD20 WMS installed.");
  });

  // iOS has no beforeinstallprompt event, so show the manual install button.
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone) {
    createInstallButton();
  }

  // Also allow a manual install button on desktop/Android browsers.
  window.addEventListener("load", function () {
    if (!window.matchMedia("(display-mode: standalone)").matches && !window.navigator.standalone) {
      createInstallButton();
    }
  });
})();
