// Plaggjakt – startpunkt: enkel router mellan flikarna i bottenmenyn.
import { fyllIkoner } from "./ikoner.js";
import { visaSok } from "./views/sok.js";
import { visaKommerSnart } from "./views/kommer-snart.js";

const vyer = {
  flode: (el) => visaKommerSnart(el, "Flöde", "Ett flöde med outfits att swipa mellan."),
  sok: visaSok,
  garderob: (el) => visaKommerSnart(el, "Min garderob", "Fota dina kläder och samla dem på ett ställe."),
  stylist: (el) => visaKommerSnart(el, "Stylist", "Outfitförslag från din egen garderob."),
};

const STARTVY = "sok";
const main = document.getElementById("vy");

function visaVy() {
  const [namn, fraga] = location.hash.replace(/^#\/?/, "").split("?");
  const vy = vyer[namn] ? namn : STARTVY;

  document.querySelectorAll(".bottenmeny a").forEach((a) => {
    a.classList.toggle("aktiv", a.dataset.flik === vy);
  });
  document.body.dataset.vy = vy;

  main.innerHTML = "";
  vyer[vy](main, new URLSearchParams(fraga || ""));
  window.scrollTo(0, 0);
  main.animate(
    [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
    { duration: 360, easing: "cubic-bezier(.2,.7,.2,1)" }
  );
}

fyllIkoner();
window.addEventListener("hashchange", visaVy);
visaVy();
