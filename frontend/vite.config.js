import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, /api é encaminhado ao backend (porta 8787).
// Assim o frontend pode deixar VITE_API_BASE vazio.
//
// ─── Por que a configuração é uma função ─────────────────────────────────────
//
// `drop: ["console", "debugger"]` só pode valer no BUILD. Aplicado sempre, ele
// também removeria o console durante `vite dev` e durante os testes, que é onde
// o log serve para alguma coisa. A forma funcional dá acesso ao `command`, que
// é "build" só na geração do bundle de produção.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  // Segunda camada contra vazamento pelo console do navegador. A primeira é não
  // passar o objeto de erro inteiro ao console (ver lib/logSafe.js): um erro do
  // axios carrega `config.headers.Authorization` com o access token dentro.
  //
  // As duas ficam, e ficam juntas, porque falham por motivos diferentes: esta
  // não protege o `vite dev` nem um console novo escrito depois, e aquela não
  // protege um console que alguém acrescente sem passar pelo helper.
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : {},
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.js'],
  },
}));
