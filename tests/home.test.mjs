// Intolerancias · tests/home.test.mjs — node tests/home.test.mjs
// Sin dependencias: carga js/home.js en un sandbox sin DOM.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name + (extra ? " → " + extra : "")); }
}

const sandbox = { window: {}, console, Date };
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "js/home.js"), "utf8"), sandbox);
const Home = sandbox.window.IntolHome;

console.log("1. Registro de tiles");
{
  const ids = Home.tiles().map((t) => t.id).join();
  ok(ids === "deposicion,animo,comida,bebida", "placeholders en orden: deposición, ánimo, comida, bebida", ids);
  ok(Home.tiles().every((t) => typeof t.onOpen !== "function"), "sin onOpen → «Próximamente»");
  Home.registerTile({ id: "bebida", emoji: "🥤", title: "Bebida", desc: "x", onOpen: () => 1 });
  const b = Home.tiles().find((t) => t.id === "bebida");
  ok(b.order === 40 && b.emoji === "🥤" && typeof b.onOpen === "function", "mismo id sustituye manteniendo posición");
  Home.registerTile({ id: "diario", order: 50, wide: true, emoji: "📝", title: "Diario", desc: "", onOpen: () => 1 });
  ok(Home.tiles().at(-1).id === "diario", "tile nuevo con order 50 va al final");
}

console.log("2. Semana L–D");
{
  const now = new Date(2026, 9, 14, 10, 0).getTime(); // miércoles
  const tiles = [{ records: () => [new Date(2026, 9, 12, 9).getTime(), new Date(2026, 9, 12, 20).getTime(), new Date(2026, 9, 11, 9).getTime()] },
    { records: () => [now] }, { records: () => { throw new Error("roto"); } }];
  const w = Home.week(now, tiles);
  ok(w.map((d) => d.letter).join("") === "LMXJVSD", "letras L M X J V S D");
  ok(w[0].date.getDate() === 12 && w[6].date.getDate() === 18, "empieza en lunes 12 y acaba en domingo 18");
  ok(w[2].today && w.filter((d) => d.today).length === 1, "hoy = miércoles");
  ok(w[0].count === 2 && w[2].count === 1 && w[1].count === 0, "cuenta registros por día (domingo 11 fuera)");
  ok(w[3].future && !w[2].future, "días futuros marcados");
  const sun = Home.week(new Date(2026, 9, 18, 23).getTime(), []);
  ok(sun[0].date.getDate() === 12 && sun[6].today, "domingo pertenece a la semana que empieza el lunes anterior");
}

console.log("3. Consejos");
{
  const t = Home.tipFor(new Date(2026, 9, 14).getTime());
  ok(Home.tips.includes(t), "tipFor devuelve un consejo de la lista");
}

console.log("\n" + pass + " ok, " + fail + " fallos");
process.exit(fail ? 1 : 0);
