/* =====================================================================
   Catapulte à conserves : script.js
   Moteur physique : Matter.js (chargé dans index.html)
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. SÉCURITÉS : afficher les erreurs sous le jeu
   --------------------------------------------------------------------- */
window.addEventListener("error", (evenement) => {
  document.getElementById("message").textContent =
    "Erreur : " + evenement.message + " (ligne " + evenement.lineno + ")";
});

// Si le CDN n'a pas chargé Matter.js, on le dit au lieu de planter
if (typeof Matter === "undefined") {
  document.getElementById("message").textContent =
    "Erreur : Matter.js n'a pas pu se charger. Vérifie ta connexion.";
  throw new Error("Matter.js introuvable");
}

// On récupère les outils de Matter.js dont on a besoin
const {
  Engine, Render, Runner, Bodies, Composite,
  Constraint, Mouse, MouseConstraint, Events
} = Matter;

/* ---------------------------------------------------------------------
   1. RÉGLAGES (tu peux les modifier pour changer le jeu)
   --------------------------------------------------------------------- */
const LARGEUR = 900;                       // doit correspondre à aspect-ratio 9/5 du CSS
const HAUTEUR = 500;
const POINT_ATTACHE = { x: 170, y: 380 };  // là où l'élastique est accroché
const RAYON_PROJECTILE = 16;
const RAIDEUR_ELASTIQUE = 0.05;            // plus grand = tir plus puissant
const COLONNES = 4;                        // boîtes sur les lignes du bas, 3 sur les lignes décalées
const LIGNES = 4;
const LARGEUR_BOITE = 36;
const HAUTEUR_BOITE = 50;
const SOL_Y = 470;                         // hauteur du dessus du sol
const PLATEFORME_X = 700;                  // centre de la plateforme
const PLATEFORME_Y = 420;                  // hauteur du dessus de la plateforme
const PLATEFORME_DEMI_LARGEUR = 110;       // la plateforme fait 220 de large
const SEUIL_CHUTE = 430;                   // une boîte plus bas que ça est "tombée"
const DISTANCE_CHUTE = 40;                 // une boîte déplacée de plus de 40 px est "tombée"
const ANGLE_CHUTE = 0.8;                   // une boîte penchée de plus de ~45° est "tombée" (radians)
const DELAI_RECHARGE = 2000;               // millisecondes avant un nouveau projectile
const COULEURS_BOITES = ["#e4572e", "#f2a541", "#4caf50", "#4a90d9"];

// Catégories de collision : permettent d'attraper seulement le projectile à la souris
const CAT_PROJECTILE = 0x0002;
const CAT_LANCE = 0x0004;

/* ---------------------------------------------------------------------
   2. MONDE PHYSIQUE ET AFFICHAGE
   --------------------------------------------------------------------- */
// Plus d'itérations = piles de boîtes plus stables
const moteur = Engine.create({ positionIterations: 10, velocityIterations: 8 });

const affichage = Render.create({
  canvas: document.getElementById("scene"),
  engine: moteur,
  options: {
    width: LARGEUR,
    height: HAUTEUR,
    pixelRatio: 1,
    wireframes: false, // false = on voit les vraies couleurs
    background: "linear-gradient(#7ec8f2, #e6f6ff)" // même ciel que dans style.css
  }
});

// Décor fixe (isStatic : ne bouge jamais)
const sol = Bodies.rectangle(LARGEUR / 2, SOL_Y + 20, LARGEUR, 40, {
  isStatic: true,
  render: { fillStyle: "#6dbb4a", strokeStyle: "#4a8a2f", lineWidth: 2 }
});

const plateforme = Bodies.rectangle(PLATEFORME_X, PLATEFORME_Y + 25, PLATEFORME_DEMI_LARGEUR * 2, 50, {
  isStatic: true,
  render: { fillStyle: "#a9743f", strokeStyle: "#5b3a1e", lineWidth: 2 }
});

const murDroit = Bodies.rectangle(LARGEUR + 15, HAUTEUR / 2, 30, HAUTEUR * 2, {
  isStatic: true,
  render: { visible: false }
});

// Montants de la catapulte : purement décoratifs (mask: 0 = rien ne les touche)
const poteau = Bodies.rectangle(POINT_ATTACHE.x, 425, 16, 90, {
  isStatic: true,
  collisionFilter: { mask: 0 },
  render: { fillStyle: "#7a4b22", strokeStyle: "#4a2d12", lineWidth: 2 }
});
const base = Bodies.rectangle(POINT_ATTACHE.x, SOL_Y - 8, 100, 16, {
  isStatic: true,
  collisionFilter: { mask: 0 },
  render: { fillStyle: "#7a4b22", strokeStyle: "#4a2d12", lineWidth: 2 }
});

Composite.add(moteur.world, [sol, plateforme, murDroit, base, poteau]);

/* ---------------------------------------------------------------------
   3. BOÎTES DE CONSERVE ET PROJECTILE (fonctions qui fabriquent)
   --------------------------------------------------------------------- */
// Les boîtes sont empilées "en quinconce" (comme des briques) : c'est beaucoup plus stable
function creerBoites() {
  const groupe = Composite.create();
  const pas = LARGEUR_BOITE + 2;                       // écart entre deux boîtes d'une ligne
  const yBas = PLATEFORME_Y - HAUTEUR_BOITE / 2 - 1;   // centre des boîtes de la ligne du bas

  for (let ligne = 0; ligne < LIGNES; ligne++) {
    const nombre = ligne % 2 === 0 ? COLONNES : COLONNES - 1;
    for (let colonne = 0; colonne < nombre; colonne++) {
      const x = PLATEFORME_X + (colonne - (nombre - 1) / 2) * pas;
      const y = yBas - ligne * (HAUTEUR_BOITE + 1);
      const boite = Bodies.rectangle(x, y, LARGEUR_BOITE, HAUTEUR_BOITE, {
        chamfer: { radius: 4 },
        friction: 0.6,
        frictionStatic: 1,
        render: {
          fillStyle: COULEURS_BOITES[ligne % COULEURS_BOITES.length],
          strokeStyle: "#444",
          lineWidth: 2
        }
      });
      boite.plugin.depart = { x: x, y: y }; // on retient où la boîte se trouvait au départ
      Composite.add(groupe, boite);
    }
  }
  return groupe;
}

function creerProjectile() {
  return Bodies.circle(POINT_ATTACHE.x, POINT_ATTACHE.y, RAYON_PROJECTILE, {
    density: 0.004,
    restitution: 0.4,
    collisionFilter: { category: CAT_PROJECTILE },
    render: { fillStyle: "#3b3b3b", strokeStyle: "#111", lineWidth: 2 }
  });
}

// Une boîte est "tombée" si elle n'est plus à sa place dans la tour
function estTombee(boite) {
  // 1. elle est sortie de la plateforme ou descendue plus bas qu'elle
  const horsPlateforme =
    boite.position.x < PLATEFORME_X - PLATEFORME_DEMI_LARGEUR ||
    boite.position.x > PLATEFORME_X + PLATEFORME_DEMI_LARGEUR;
  if (horsPlateforme || boite.position.y > SEUIL_CHUTE) return true;

  // 2. elle s'est déplacée par rapport à sa position de départ
  const dx = boite.position.x - boite.plugin.depart.x;
  const dy = boite.position.y - boite.plugin.depart.y;
  if (Math.sqrt(dx * dx + dy * dy) > DISTANCE_CHUTE) return true;

  // 3. elle est penchée ou renversée (l'angle est ramené entre -180° et 180°)
  const angle = Math.atan2(Math.sin(boite.angle), Math.cos(boite.angle));
  return Math.abs(angle) > ANGLE_CHUTE;
}

/* ---------------------------------------------------------------------
   4. ÉLASTIQUE (la "catapulte") ET CONTRÔLES SOURIS / TACTILE
   --------------------------------------------------------------------- */
// L'élastique relie le point d'attache au projectile (bodyB sera rempli plus tard)
const elastique = Constraint.create({
  pointA: POINT_ATTACHE,
  pointB: { x: 0, y: 0 },
  angleB: 0,
  length: 0.01,
  damping: 0.01,
  stiffness: RAIDEUR_ELASTIQUE,
  render: { strokeStyle: "#5b3a1e", lineWidth: 4 }
});
Composite.add(moteur.world, elastique);

// Souris (et doigt) : seul le projectile peut être attrapé
const souris = Mouse.create(affichage.canvas);
const contrainteSouris = MouseConstraint.create(moteur, {
  mouse: souris,
  collisionFilter: { mask: CAT_PROJECTILE },
  constraint: { stiffness: 0.2, render: { visible: false } }
});
Composite.add(moteur.world, contrainteSouris);
affichage.mouse = souris;

// On laisse la molette faire défiler la page quand la souris est sur le jeu
souris.element.removeEventListener("wheel", souris.mousewheel);
souris.element.removeEventListener("mousewheel", souris.mousewheel);
souris.element.removeEventListener("DOMMouseScroll", souris.mousewheel);

/* ---------------------------------------------------------------------
   5. ÉTAT DU JEU ET RÈGLES
   --------------------------------------------------------------------- */
const elTirs = document.getElementById("compteur-tirs");
const elBoites = document.getElementById("compteur-boites");
const elTotal = document.getElementById("total-boites");
const elMessage = document.getElementById("message");
const boutonRejouer = document.getElementById("bouton-rejouer");

let boites = null;          // la pile de boîtes
let projectile = null;      // le projectile actuel
let tirs = 0;
let boitesTombees = 0;
let partieFinie = false;
let minuteur = null;        // pour le délai avant le prochain projectile

function majAffichage() {
  elTirs.textContent = tirs;
  elBoites.textContent = boitesTombees;
  elTotal.textContent = boites ? boites.bodies.length : 0;
}

function accrocherNouveauProjectile() {
  projectile = creerProjectile();
  Composite.add(moteur.world, projectile);
  elastique.pointB = { x: 0, y: 0 };    // on remet l'accroche à zéro
  elastique.angleB = projectile.angle;  // évite un calcul invalide dans Matter.js
  elastique.bodyB = projectile;
  elastique.render.visible = true;
}

function lancer() {
  // On décroche l'élastique : le projectile part tout seul
  elastique.bodyB = null;
  elastique.render.visible = false;
  projectile.collisionFilter.category = CAT_LANCE; // on ne peut plus le rattraper
  tirs++;
  majAffichage();
  minuteur = setTimeout(recharger, DELAI_RECHARGE);
}

function recharger() {
  if (partieFinie) return;
  Composite.remove(moteur.world, projectile); // on retire l'ancien projectile
  accrocherNouveauProjectile();
}

function nouvellePartie() {
  clearTimeout(minuteur);
  if (boites) Composite.remove(moteur.world, boites);
  if (projectile) Composite.remove(moteur.world, projectile);

  boites = creerBoites();
  Composite.add(moteur.world, boites);
  accrocherNouveauProjectile();

  tirs = 0;
  boitesTombees = 0;
  partieFinie = false;
  elMessage.textContent = "Tire la boule vers le bas-gauche, puis relâche !";
  majAffichage();
}

// Après chaque calcul de physique : a-t-on lâché le projectile ? des boîtes sont-elles tombées ?
Events.on(moteur, "afterUpdate", () => {
  // Le bouton de la souris est relâché (-1) et le projectile a dépassé le point d'attache
  if (elastique.bodyB && souris.button === -1) {
    const depasse =
      projectile.position.x > POINT_ATTACHE.x + 20 ||
      projectile.position.y < POINT_ATTACHE.y - 20;
    if (depasse) lancer();
  }

  // Comptage des boîtes tombées
  const n = boites.bodies.filter(estTombee).length;
  if (n !== boitesTombees) {
    boitesTombees = n;
    majAffichage();
  }

  // Victoire
  if (!partieFinie && n === boites.bodies.length) {
    partieFinie = true;
    elMessage.textContent =
      "Bravo ! Toutes les boîtes sont tombées en " + tirs + (tirs > 1 ? " tirs" : " tir") + " !";
  }
});

boutonRejouer.addEventListener("click", nouvellePartie);

/* ---------------------------------------------------------------------
   6. DÉMARRAGE
   --------------------------------------------------------------------- */
nouvellePartie();
Render.run(affichage);
Runner.run(Runner.create(), moteur);