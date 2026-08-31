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
