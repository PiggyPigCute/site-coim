// Gestion des drapeaux : si le .png n'existe pas, on tente le .jpg,
// sinon on affiche un motif de remplacement (voir .flag-missing en CSS).
function handleFlagError(img) {
  const tried = img.dataset.triedJpg;
  if (!tried) {
    img.dataset.triedJpg = "1";
    img.src = img.src.replace(/\.png$/i, ".jpg");
    return;
  }
  img.style.display = "none";
  img.closest(".flag")?.classList.add("flag-missing");
}

// Génère la liste des membres du COIM à partir de membres.csv (nom;score;drapeau),
// triée par score décroissant. Nécessite que la page soit servie via http(s) :
// un fetch() de fichier local échoue si le fichier est simplement ouvert (file://).
async function loadMembers() {
  const list = document.getElementById("membersList");
  if (!list) return;

  const response = await fetch("membres.csv");
  const text = await response.text();

  const membres = text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [nom, score, drapeau] = line.split(";");
      return {
        nom: nom.trim(),
        score: Number(score),
        drapeau: drapeau ? drapeau.trim() : "",
      };
    });

  membres.sort((a, b) => b.score - a.score);

  for (const membre of membres) {
    const li = document.createElement("li");
    li.className = "members-item";

    const flag = document.createElement("span");
    flag.className = "flag";
    if (membre.drapeau) {
      const img = document.createElement("img");
      img.src = `imgs/drapeaux/${membre.drapeau}.png`;
      img.alt = `Drapeau de ${membre.nom}`;
      img.loading = "lazy";
      img.addEventListener("error", () => handleFlagError(img));
      flag.appendChild(img);
    } else {
      flag.classList.add("flag-missing");
    }

    const name = document.createElement("span");
    name.className = "member-name-text";
    name.textContent = membre.nom;

    li.append(flag, name);
    list.appendChild(li);
  }
}

loadMembers();
