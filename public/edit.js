// Page /edit : connexion puis modification de la liste des membres.
// Utilise flagUrl() et handleFlagError() de script.js.

const loginSection = document.getElementById("loginSection");
const editSection = document.getElementById("editSection");
const rowTemplate = document.getElementById("rowTemplate");

async function api(method, url, body) {
  const options = { method };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== "/api/login") showLogin();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
}

// ----- Connexion -----
function showLogin() {
  editSection.hidden = true;
  document.getElementById("userBox").hidden = true;
  loginSection.hidden = false;
}

function showEditor(user) {
  loginSection.hidden = true;
  document.getElementById("userName").textContent = user;
  document.getElementById("userBox").hidden = false;
  editSection.hidden = false;
  loadMembres();
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const error = document.getElementById("loginError");
  error.textContent = "";
  try {
    const { user } = await api("POST", "/api/login", {
      username: form.username.value,
      password: form.password.value,
      stayConnected: form.stayConnected.checked,
    });
    form.password.value = "";
    showEditor(user);
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  showLogin();
});

// ----- Lignes membre -----
function setFlag(row, src) {
  const pick = row.querySelector(".flag-pick");
  const img = pick.querySelector("img");
  delete img.dataset.triedJpg;
  if (src) {
    pick.classList.remove("flag-missing");
    img.style.display = "";
    img.src = src;
  } else {
    pick.classList.add("flag-missing");
    img.style.display = "none";
    img.removeAttribute("src");
  }
}

// membre = null pour le formulaire d'ajout
function createRow(membre) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  const img = row.querySelector(".flag-pick img");
  const fileInput = row.elements.drapeau;
  const noFlag = row.elements.sansDrapeau;
  img.addEventListener("error", () => handleFlagError(img));

  if (membre) {
    row.elements.nom.value = membre.nom;
    row.elements.score.value = membre.score;
    setFlag(row, membre.drapeau ? flagUrl(membre.drapeau) : null);
    img.alt = `Drapeau de ${membre.nom}`;
  } else {
    row.elements.score.value = 0;
    setFlag(row, null);
    noFlag.closest("label").remove();
    row.querySelector(".edit-delete").remove();
    row.querySelector(".edit-save").textContent = "Ajouter";
  }

  row.addEventListener("input", () => row.classList.add("dirty"));

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (membre) noFlag.checked = false;
    setFlag(row, URL.createObjectURL(file));
  });

  if (membre) {
    noFlag.addEventListener("change", () => {
      if (noFlag.checked) {
        fileInput.value = "";
        setFlag(row, null);
      } else {
        setFlag(row, membre.drapeau ? flagUrl(membre.drapeau) : null);
      }
    });

    row.querySelector(".edit-delete").addEventListener("click", async () => {
      if (!confirm(`Supprimer « ${membre.nom} » de la liste des membres ?`)) return;
      try {
        await api("DELETE", `/api/membres/${encodeURIComponent(membre.nom)}`);
        toast(`${membre.nom} supprimé`);
        loadMembres();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  row.addEventListener("submit", async (e) => {
    e.preventDefault();
    const buttons = row.querySelectorAll("button");
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const data = new FormData(row);
      if (!fileInput.files[0]) data.delete("drapeau");
      if (membre) {
        await api("PUT", `/api/membres/${encodeURIComponent(membre.nom)}`, data);
        row.classList.remove("dirty");
        toast(`${data.get("nom")} enregistré`);
      } else {
        await api("POST", "/api/membres", data);
        toast(`${data.get("nom")} ajouté`);
        renderAddRow();
      }
      loadMembres();
    } catch (err) {
      toast(err.message, true);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  });

  return row;
}

function renderAddRow() {
  document.getElementById("addRow").replaceChildren(createRow(null));
}

// Recharge la liste depuis le serveur. Les lignes modifiées mais non
// enregistrées sont conservées telles quelles.
async function loadMembres() {
  let membres;
  try {
    membres = await api("GET", "/api/membres");
  } catch (err) {
    toast(err.message, true);
    return;
  }
  membres.sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, "fr"));

  const container = document.getElementById("memberRows");
  const dirty = new Map();
  for (const row of container.querySelectorAll(".edit-row.dirty")) {
    dirty.set(row.dataset.nom, row);
  }

  container.replaceChildren(...membres.map((m) => {
    const row = dirty.get(m.nom) || createRow(m);
    row.dataset.nom = m.nom;
    return row;
  }));
  document.getElementById("memberCount").textContent = `(${membres.length})`;
}

// ----- Démarrage -----
renderAddRow();
api("GET", "/api/me")
  .then(({ user }) => (user ? showEditor(user) : showLogin()))
  .catch(() => showLogin());
