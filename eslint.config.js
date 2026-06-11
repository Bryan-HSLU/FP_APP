// Flache ESLint-Konfiguration für das ganze Monorepo (TS-Pakete).
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/src/generated/**"],
  },
  {
    rules: {
      // Verträge/Interpreter arbeiten mit dynamischem JSON – bewusst erlaubt,
      // aber nur mit explizitem `unknown`-Umweg (kein blankes any).
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
